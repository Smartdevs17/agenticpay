import { Request, Response, NextFunction } from 'express';
import { verifyWebhookSignature, queueFailedWebhook, WebhookProvider } from '../services/webhooks/verification.js';
import { AppError } from './errorHandler.js';

export interface WebhookVerificationConfig {
  provider: WebhookProvider;
  signatureHeader: string;
  timestampHeader: string;
  toleranceSeconds?: number;
  maxRetries?: number;
}

/**
 * Middleware to verify webhook signatures
 */
export function verifyWebhook(config: WebhookVerificationConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const signature = req.headers[config.signatureHeader.toLowerCase()] as string;
      const timestamp = req.headers[config.timestampHeader.toLowerCase()] as string;

      if (!signature) {
        throw new AppError(400, `Missing ${config.signatureHeader} header`, 'WEBHOOK_VERIFICATION_FAILED');
      }

      if (!timestamp) {
        throw new AppError(400, `Missing ${config.timestampHeader} header`, 'WEBHOOK_VERIFICATION_FAILED');
      }

      // Get raw body for signature verification
      const body = req.rawBody || JSON.stringify(req.body);

      const result = verifyWebhookSignature({
        signature,
        timestamp,
        body,
        provider: config.provider,
        toleranceSeconds: config.toleranceSeconds || 300,
      });

      if (!result.isValid) {
        // Queue failed webhook for retry
        const event = queueFailedWebhook(
          config.provider,
          req.headers['x-webhook-event-type'] as string || 'unknown',
          req.body,
          signature,
          timestamp,
          result.error || 'Verification failed'
        );

        // Log verification failure
        console.warn(`Webhook verification failed for ${config.provider}:`, {
          eventId: event.id,
          error: result.error,
          timestamp: result.timestamp,
          provider: result.provider,
        });

        throw new AppError(401, `Webhook verification failed: ${result.error}`, 'WEBHOOK_VERIFICATION_FAILED');
      }

      // Attach verification result to request for downstream handlers
      (req as any).webhookVerification = result;

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Pre-built verification middleware for common providers
 */
export const webhookVerifiers = {
  stripe: verifyWebhook({
    provider: 'stripe',
    signatureHeader: 'stripe-signature',
    timestampHeader: 'stripe-timestamp',
    toleranceSeconds: 300,
  }),

  paypal: verifyWebhook({
    provider: 'paypal',
    signatureHeader: 'paypal-transmission-signature',
    timestampHeader: 'paypal-transmission-time',
    toleranceSeconds: 300,
  }),

  github: verifyWebhook({
    provider: 'github',
    signatureHeader: 'x-hub-signature-256',
    timestampHeader: 'x-github-delivery', // GitHub doesn't use timestamp header, but we can use delivery ID
    toleranceSeconds: 300,
  }),

  custom: verifyWebhook({
    provider: 'custom',
    signatureHeader: 'x-signature',
    timestampHeader: 'x-timestamp',
    toleranceSeconds: 300,
  }),
};

/**
 * Middleware to capture raw body for webhook verification
 * Must be used before express.json() middleware
 */
export function rawBodyCapture() {
  return (req: Request, res: Response, next: NextFunction) => {
    let data = '';

    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });

    req.on('end', () => {
      (req as any).rawBody = data;
      next();
    });

    req.on('error', (err) => {
      next(err);
    });
  };
}