import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { constructWebhookEvent } from '../stripe.js';
import { AppError } from '../../middleware/errorHandler.js';
import type { WebhookProvider } from './verification.js';
import {
  generateWebhookSignature,
  getActiveSecretsForProvider,
  verifyWebhookSignature,
} from './verification.js';

export interface ProviderVerificationResult {
  isValid: boolean;
  provider: WebhookProvider;
  eventId: string;
  timestamp: Date;
  body: string;
  error?: string;
  payload?: unknown;
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function verifyStripeProviderWebhook(req: Request, rawBody: string): ProviderVerificationResult {
  const sig = req.headers['stripe-signature'] as string | undefined;
  if (!sig) {
    return {
      isValid: false,
      provider: 'stripe',
      eventId: 'unknown',
      timestamp: new Date(),
      body: rawBody,
      error: 'Missing stripe-signature header',
    };
  }
  try {
    const event = constructWebhookEvent(Buffer.from(rawBody, 'utf8'), sig);
    return {
      isValid: true,
      provider: 'stripe',
      eventId: event.id,
      timestamp: new Date(event.created * 1000),
      body: rawBody,
      payload: event,
    };
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'Stripe signature verification failed';
    return {
      isValid: false,
      provider: 'stripe',
      eventId: 'unknown',
      timestamp: new Date(),
      body: rawBody,
      error: message,
    };
  }
}

export function verifyGithubProviderWebhook(req: Request, rawBody: string): ProviderVerificationResult {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const deliveryId = (req.headers['x-github-delivery'] as string) || `github_${Date.now()}`;
  const secrets = getActiveSecretsForProvider('github');

  if (!signature?.startsWith('sha256=')) {
    return {
      isValid: false,
      provider: 'github',
      eventId: deliveryId,
      timestamp: new Date(),
      body: rawBody,
      error: 'Missing or invalid x-hub-signature-256',
    };
  }

  const provided = signature.slice('sha256='.length);
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret.secret).update(rawBody).digest('hex');
    if (safeEqualHex(expected, provided)) {
      return {
        isValid: true,
        provider: 'github',
        eventId: deliveryId,
        timestamp: new Date(),
        body: rawBody,
        payload: JSON.parse(rawBody),
      };
    }
  }

  return {
    isValid: false,
    provider: 'github',
    eventId: deliveryId,
    timestamp: new Date(),
    body: rawBody,
    error: 'GitHub signature verification failed',
  };
}

export function verifyGenericProviderWebhook(
  provider: WebhookProvider,
  req: Request,
  rawBody: string,
  signatureHeader: string,
  timestampHeader: string,
  toleranceSeconds = 300,
): ProviderVerificationResult {
  const signature = req.headers[signatureHeader.toLowerCase()] as string | undefined;
  const timestamp = req.headers[timestampHeader.toLowerCase()] as string | undefined;
  const eventId =
    (req.headers['x-webhook-id'] as string) ||
    (req.headers['paypal-transmission-id'] as string) ||
    `${provider}_${Date.now()}`;

  if (!signature || !timestamp) {
    return {
      isValid: false,
      provider,
      eventId,
      timestamp: new Date(),
      body: rawBody,
      error: `Missing ${signatureHeader} or ${timestampHeader}`,
    };
  }

  const keyId = req.headers['x-webhook-key-id'] as string | undefined;
  const result = verifyWebhookSignature({
    signature: signature.replace(/^sha256=/, ''),
    timestamp,
    body: rawBody,
    provider,
    toleranceSeconds,
    keyId,
  });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = rawBody;
  }

  return {
    isValid: result.isValid,
    provider,
    eventId,
    timestamp: result.timestamp,
    body: rawBody,
    error: result.error,
    payload,
  };
}

export function verifyPaypalProviderWebhook(req: Request, rawBody: string): ProviderVerificationResult {
  return verifyGenericProviderWebhook(
    'paypal',
    req,
    rawBody,
    'paypal-transmission-signature',
    'paypal-transmission-time',
  );
}

export function verifyCustomProviderWebhook(req: Request, rawBody: string): ProviderVerificationResult {
  const sig = req.headers['x-signature'] as string | undefined;
  const ts = req.headers['x-timestamp'] as string | undefined;
  if (!sig || !ts) {
    return verifyGenericProviderWebhook('custom', req, rawBody, 'x-signature', 'x-timestamp');
  }
  const result = verifyWebhookSignature({
    signature: sig.replace(/^sha256=/, ''),
    timestamp: ts,
    body: rawBody,
    provider: 'custom',
    keyId: req.headers['x-webhook-key-id'] as string | undefined,
  });
  return {
    isValid: result.isValid,
    provider: 'custom',
    eventId: (req.headers['x-webhook-id'] as string) || `custom_${Date.now()}`,
    timestamp: result.timestamp,
    body: rawBody,
    error: result.error,
    payload: JSON.parse(rawBody),
  };
}

/** Dev/test helper: sign outbound webhooks with AgenticPay format */
export function signTestWebhook(payload: string, secret: string, timestamp: string): string {
  return generateWebhookSignature(payload, secret, timestamp);
}
