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
import { getWebhookKeyRegistry } from '../services/webhookKeys.js';
import { isReplayEvent } from '../services/webhooks/replay.js';
import { storeWebhookPayload } from '../services/webhooks/audit.js';
import { createModuleLogger } from './logger.js';
import { AppError } from './errorHandler.js';

const webhookLog = createModuleLogger('webhooks');

export interface WebhookVerificationConfig {
  useKeyRotation?: boolean;
  toleranceSeconds?: number;
}

export const webhookVerificationConfig: WebhookVerificationConfig = {
  useKeyRotation: true,
};

export function configureWebhookVerification(config: WebhookVerificationConfig): WebhookVerificationConfig {
  if (config.useKeyRotation !== undefined) {
    webhookVerificationConfig.useKeyRotation = config.useKeyRotation;
  }
  if (config.toleranceSeconds !== undefined) {
    webhookVerificationConfig.toleranceSeconds = config.toleranceSeconds;
  }
  return webhookVerificationConfig;
}

export function resetWebhookVerificationConfig(): void {
  webhookVerificationConfig.useKeyRotation = true;
  webhookVerificationConfig.toleranceSeconds = undefined;
}

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

const CUSTOM_SIGNATURE_HEADERS = ['x-agenticpay-signature', 'x-signature'] as const;
const CUSTOM_TIMESTAMP_HEADERS = ['x-agenticpay-timestamp', 'x-timestamp'] as const;

function firstHeader(req: Request, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = req.headers[name];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      return value[0];
    }
  }
  return undefined;
}

export function verifyCustomProviderWebhookWithKeys(req: Request, rawBody: string): ProviderVerificationResult {
  const registry = getWebhookKeyRegistry();
  const signature = firstHeader(req, CUSTOM_SIGNATURE_HEADERS);
  const timestamp = firstHeader(req, CUSTOM_TIMESTAMP_HEADERS);

  if (webhookVerificationConfig.useKeyRotation && registry.hasKeysForProvider('custom') && signature && timestamp) {
    const result = registry.verify({
      signature,
      timestamp,
      body: rawBody,
      provider: 'custom',
      keyId: typeof req.headers['x-webhook-key-id'] === 'string' ? req.headers['x-webhook-key-id'] : undefined,
      toleranceSeconds: webhookVerificationConfig.toleranceSeconds,
    });

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = rawBody;
    }

    return {
      isValid: result.isValid,
      provider: 'custom',
      eventId: (req.headers['x-webhook-id'] as string) || `custom_${Date.now()}`,
      timestamp: new Date(result.timestamp),
      body: rawBody,
      error: result.isValid ? undefined : result.error,
      payload,
    };
  }

  return verifyCustomProviderWebhook(req, rawBody);
}

const providerVerifiers: Record<WebhookProvider, ProviderVerifier> = {
  stripe: verifyStripeProviderWebhook,
  paypal: verifyPaypalProviderWebhook,
  github: verifyGithubProviderWebhook,
  custom: verifyCustomProviderWebhookWithKeys,
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
