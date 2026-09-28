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
  type ProviderVerificationResult,
} from '../services/webhooks/providers.js';
import { isReplayEvent } from '../services/webhooks/replay.js';
import { storeWebhookPayload } from '../services/webhooks/audit.js';
import { createModuleLogger } from './logger.js';
import { AppError } from './errorHandler.js';

const webhookLog = createModuleLogger('webhooks');

declare global {
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
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawBody = req.rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
      const verify = providerVerifiers[provider];
      const result = verify(req, rawBody);

      storeWebhookPayload({
        provider,
        eventId: result.eventId,
        payload: result.payload ?? req.body,
        signature: (req.headers['stripe-signature'] ||
          req.headers['x-hub-signature-256'] ||
          req.headers['x-signature'] ||
          '') as string,
        verified: result.isValid,
        error: result.error,
      });

      if (result.isValid && isReplayEvent(`${provider}:${result.eventId}`)) {
        webhookLog.warn({ provider, eventId: result.eventId }, 'Webhook replay detected');
        throw new AppError(409, 'Duplicate webhook delivery', 'WEBHOOK_REPLAY');
      }

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
            req.webhookVerification = { ...result, isValid: true };
            req.body = result.payload ?? req.body;
            return next();
          }
        }

        throw new AppError(401, `Webhook verification failed: ${result.error}`, 'WEBHOOK_VERIFICATION_FAILED');
      }

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

export const webhookVerifiers = {
  stripe: verifyWebhookProvider('stripe'),
  paypal: verifyWebhookProvider('paypal'),
  github: verifyWebhookProvider('github'),
  custom: verifyWebhookProvider('custom'),
};
