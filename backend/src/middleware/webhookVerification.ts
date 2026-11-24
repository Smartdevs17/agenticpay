import express, { Request, Response, NextFunction } from 'express';
import {
  queueFailedWebhook,
  retryWebhook,
  type WebhookProvider,
} from '../services/webhooks/verification.js';
import {
  verifyStripeProviderWebhook,
  verifyGithubProviderWebhook,
  verifyPaypalProviderWebhook,
  verifyCustomProviderWebhook,
  verifyBankPartnerWebhook,
  type ProviderVerificationResult,
} from '../services/webhooks/providers.js';
import { getWebhookReplayGuard, type WebhookDelivery } from '../services/webhookReplay.js';
import { storeWebhookPayload } from '../services/webhooks/audit.js';
import { createModuleLogger } from './logger.js';
import { AppError } from './errorHandler.js';
import { webhookJwtAuth } from './webhookAuth.js';

const webhookLog = createModuleLogger('webhooks');

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express augments its Request type through this namespace.
  namespace Express {
    interface Request {
      rawBody?: string;
      webhookVerification?: ProviderVerificationResult;
    }
  }
}

export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  if (buf?.length) {
    req.rawBody = buf.toString('utf8');
  }
}

/** JSON parser that preserves raw body for HMAC verification */
export const webhookJsonParser = express.json({
  verify: captureRawBody,
  limit: '2mb',
});

type ProviderVerifier = (req: Request, rawBody: string) => ProviderVerificationResult;

const providerVerifiers: Record<WebhookProvider, ProviderVerifier> = {
  stripe: verifyStripeProviderWebhook,
  paypal: verifyPaypalProviderWebhook,
  github: verifyGithubProviderWebhook,
  custom: verifyCustomProviderWebhook,
};

export function verifyWebhookProvider(provider: WebhookProvider) {
  return createWebhookVerifier(provider, providerVerifiers[provider]);
}

/** The header each verifier checks; only that one may identify a delivery. */
const PROVIDER_SIGNATURE_HEADER: Record<WebhookProvider, string> = {
  stripe: 'stripe-signature',
  paypal: 'paypal-transmission-signature',
  github: 'x-hub-signature-256',
  custom: 'x-signature',
};

export interface WebhookReceiptOptions {
  /** Receipt namespace; defaults to the provider. */
  namespace?: string;
  /** Signature header the verifier checks; defaults to the provider's. */
  signatureHeader?: string;
}

/**
 * Builds a verification middleware around any provider verifier. Extracted so
 * additional partners (e.g. the bank-partner payout webhook, #1006) can reuse the
 * same store/replay/queue behaviour without widening the `WebhookProvider` enum.
 */
export function createWebhookVerifier(
  provider: WebhookProvider,
  verify: ProviderVerifier,
  receipt: WebhookReceiptOptions = {},
) {
  // Fixed per route, never taken from the request: extra headers on a
  // replayed delivery must not change how it is identified.
  const namespace = receipt.namespace ?? provider;
  const signatureHeaderName = receipt.signatureHeader ?? PROVIDER_SIGNATURE_HEADER[provider];
  const webhookJwtMiddleware = webhookJwtAuth();
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await new Promise<void>((resolve, reject) => {
        webhookJwtMiddleware(req, res, (error?: unknown) => {
          if (error) reject(error);
          else resolve();
        });
      });
      const rawBody = req.rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
      const result = verify(req, rawBody);

      storeWebhookPayload({
        provider,
        eventId: result.eventId,
        payload: result.payload ?? req.body,
        signature: headerValue(req, signatureHeaderName) ?? '',
        verified: result.isValid,
        error: result.error,
      });

      const delivery = {
        provider: namespace,
        eventId: result.eventId,
        rawBody,
        signature: headerValue(req, signatureHeaderName),
        eventTimestamp: providerSignsTimestamp(provider) ? result.timestamp : undefined,
      };

      if (!result.isValid) {
        const event = queueFailedWebhook(
          provider,
          (req.headers['x-webhook-event-type'] as string) || 'unknown',
          result.payload ?? req.body,
          (req.headers['x-signature'] as string) || '',
          result.timestamp.toISOString(),
          result.error || 'Verification failed',
        );

        webhookLog.warn(
          { provider, eventId: event.id, error: result.error },
          'Webhook verification failed',
        );

        if (result.error?.includes('timeout') || result.error?.includes('network')) {
          const retried = retryWebhook(event.id);
          if (retried?.isValid) {
            await claimWebhookDelivery(req, res, delivery);
            req.webhookVerification = { ...result, isValid: true };
            req.body = result.payload ?? req.body;
            return next();
          }
        }

        throw new AppError(401, `Webhook verification failed: ${result.error}`, 'WEBHOOK_VERIFICATION_FAILED');
      }

      await claimWebhookDelivery(req, res, delivery);

      req.webhookVerification = result;
      if (result.payload !== undefined) {
        req.body = result.payload;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' && value ? value : undefined;
}

/** Providers whose verified timestamp is covered by the signature. GitHub's is not (it is "now"). */
function providerSignsTimestamp(provider: WebhookProvider): boolean {
  return provider !== 'github';
}

/**
 * Record a verified delivery in the replay-receipt table (#1472) before the
 * handler runs, and settle the receipt from the response status once it is
 * sent. Throws 409 for replays and ID reuse, 400 for deliveries older than
 * the replay window and 503 if receipts cannot be stored (so the provider
 * retries instead of the handler running unguarded).
 *
 * Every inbound webhook route calls this, directly or through
 * `createWebhookVerifier`, after its signature check has passed.
 */
export async function claimWebhookDelivery(
  req: Request,
  res: Response,
  delivery: Omit<WebhookDelivery, 'sourceIp'>,
): Promise<void> {
  const guard = getWebhookReplayGuard();
  let claim;
  try {
    claim = await guard.claim({ ...delivery, sourceIp: req.ip });
  } catch (error) {
    webhookLog.error({ err: error, provider: delivery.provider, eventId: delivery.eventId }, 'Webhook receipt store unavailable');
    throw new AppError(503, 'Webhook receipts unavailable; retry later', 'WEBHOOK_RECEIPT_UNAVAILABLE');
  }

  switch (claim.outcome) {
    case 'duplicate':
      res.setHeader?.('X-Webhook-Receipt', 'duplicate');
      throw new AppError(409, 'Duplicate webhook delivery', 'WEBHOOK_REPLAY');
    case 'conflict':
      throw new AppError(409, 'Webhook event ID was already used with a different payload', 'WEBHOOK_EVENT_CONFLICT');
    case 'stale':
      throw new AppError(400, 'Webhook event is older than the replay window', 'WEBHOOK_EVENT_STALE');
    case 'accepted':
      break;
  }

  res.setHeader?.('X-Webhook-Receipt', claim.reclaimed ? 'retry' : 'accepted');
  if (typeof res.once !== 'function') return;

  let settled = false;
  const settle = (status: number | null) => {
    if (settled) return;
    settled = true;
    guard.finish(delivery.provider, delivery.eventId, status).catch((error) => {
      webhookLog.error({ err: error, provider: delivery.provider, eventId: delivery.eventId }, 'Failed to settle webhook receipt');
    });
  };
  res.once('finish', () => settle(res.statusCode));
  // Closed before the response finished: the provider saw no answer and will retry.
  res.once('close', () => settle(res.writableFinished ? res.statusCode : null));
}

export const webhookVerifiers = {
  stripe: verifyWebhookProvider('stripe'),
  paypal: verifyWebhookProvider('paypal'),
  github: verifyWebhookProvider('github'),
  custom: verifyWebhookProvider('custom'),
};

/** Bank-partner payout webhooks use the shared replay/queue machinery (#1006). */
export const bankPartnerWebhookVerifier = createWebhookVerifier('custom', verifyBankPartnerWebhook, {
  namespace: 'bank-partner',
  signatureHeader: 'x-bank-signature',
});
