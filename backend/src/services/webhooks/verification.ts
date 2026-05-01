import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../middleware/errorHandler.js';

export const webhookProviderSchema = z.enum(['stripe', 'paypal', 'github', 'custom']);

export const webhookSecretSchema = z.object({
  id: z.string(),
  provider: webhookProviderSchema,
  secret: z.string().min(32, 'Secret must be at least 32 characters'),
  isActive: z.boolean().default(true),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
  lastUsedAt: z.string().optional(),
});

export const webhookVerificationSchema = z.object({
  signature: z.string(),
  timestamp: z.string(),
  body: z.string(),
  provider: webhookProviderSchema,
  toleranceSeconds: z.number().default(300), // 5 minutes default tolerance
});

export type WebhookProvider = z.infer<typeof webhookProviderSchema>;
export type WebhookSecret = z.infer<typeof webhookSecretSchema>;
export type WebhookVerificationInput = z.infer<typeof webhookVerificationSchema>;

export interface WebhookVerificationResult {
  isValid: boolean;
  provider: WebhookProvider;
  timestamp: Date;
  error?: string;
}

export interface WebhookEvent {
  id: string;
  provider: WebhookProvider;
  eventType: string;
  payload: any;
  signature: string;
  timestamp: string;
  verified: boolean;
  processed: boolean;
  createdAt: string;
  processedAt?: string;
  error?: string;
  retryCount: number;
}

// In-memory storage (in production, use database)
const webhookSecrets = new Map<string, WebhookSecret>();
const webhookEvents = new Map<string, WebhookEvent>();

/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
export function generateWebhookSignature(
  payload: string,
  secret: string,
  timestamp: string
): string {
  const message = `${timestamp}.${payload}`;
  return createHmac('sha256', secret)
    .update(message)
    .digest('hex');
}

/**
 * Verify webhook signature using HMAC-SHA256
 */
export function verifyWebhookSignature(
  input: WebhookVerificationInput
): WebhookVerificationResult {
  const parsed = webhookVerificationSchema.parse(input);

  // Get active secret for provider
  const secret = getActiveSecretForProvider(parsed.provider);
  if (!secret) {
    return {
      isValid: false,
      provider: parsed.provider,
      timestamp: new Date(parsed.timestamp),
      error: `No active secret found for provider: ${parsed.provider}`,
    };
  }

  // Verify timestamp is within tolerance (replay protection)
  const now = new Date();
  const timestamp = new Date(parsed.timestamp);
  const toleranceMs = parsed.toleranceSeconds * 1000;
  const timeDiff = Math.abs(now.getTime() - timestamp.getTime());

  if (timeDiff > toleranceMs) {
    return {
      isValid: false,
      provider: parsed.provider,
      timestamp,
      error: `Timestamp outside tolerance window (${timeDiff}ms > ${toleranceMs}ms)`,
    };
  }

  // Generate expected signature
  const expectedSignature = generateWebhookSignature(
    parsed.body,
    secret.secret,
    parsed.timestamp
  );

  // Compare signatures (constant-time comparison to prevent timing attacks)
  const isValid = constantTimeEquals(expectedSignature, parsed.signature);

  // Update last used timestamp
  updateSecretLastUsed(secret.id);

  return {
    isValid,
    provider: parsed.provider,
    timestamp,
    error: isValid ? undefined : 'Signature verification failed',
  };
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Create a new webhook secret for a provider
 */
export function createWebhookSecret(
  provider: WebhookProvider,
  secret: string,
  expiresAt?: string
): WebhookSecret {
  const id = `whs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const webhookSecret: WebhookSecret = {
    id,
    provider,
    secret,
    isActive: true,
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  webhookSecrets.set(id, webhookSecret);
  return webhookSecret;
}

/**
 * Get active secret for a provider
 */
export function getActiveSecretForProvider(provider: WebhookProvider): WebhookSecret | null {
  const activeSecrets = Array.from(webhookSecrets.values())
    .filter(secret => secret.provider === provider && secret.isActive)
    .filter(secret => !secret.expiresAt || new Date(secret.expiresAt) >= new Date())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return activeSecrets.length > 0 ? activeSecrets[0] : null;
}

/**
 * Rotate webhook secret for a provider
 */
export function rotateWebhookSecret(
  provider: WebhookProvider,
  newSecret: string,
  gracePeriodHours: number = 24
): WebhookSecret {
  // Deactivate current secret
  const currentSecret = getActiveSecretForProvider(provider);
  if (currentSecret) {
    currentSecret.isActive = false;
    currentSecret.expiresAt = new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000).toISOString();
    webhookSecrets.set(currentSecret.id, currentSecret);
  }

  // Create new active secret
  return createWebhookSecret(provider, newSecret);
}

/**
 * Update last used timestamp for a secret
 */
function updateSecretLastUsed(secretId: string): void {
  const secret = webhookSecrets.get(secretId);
  if (secret) {
    secret.lastUsedAt = new Date().toISOString();
    webhookSecrets.set(secretId, secret);
  }
}

/**
 * Get all webhook secrets (for admin)
 */
export function getAllWebhookSecrets(): WebhookSecret[] {
  return Array.from(webhookSecrets.values());
}

/**
 * Deactivate a webhook secret
 */
export function deactivateWebhookSecret(secretId: string): boolean {
  const secret = webhookSecrets.get(secretId);
  if (secret) {
    secret.isActive = false;
    webhookSecrets.set(secretId, secret);
    return true;
  }
  return false;
}

/**
 * Queue failed webhook for retry
 */
export function queueFailedWebhook(
  provider: WebhookProvider,
  eventType: string,
  payload: any,
  signature: string,
  timestamp: string,
  error: string
): WebhookEvent {
  const id = `whe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const webhookEvent: WebhookEvent = {
    id,
    provider,
    eventType,
    payload,
    signature,
    timestamp,
    verified: false,
    processed: false,
    createdAt: new Date().toISOString(),
    error,
    retryCount: 0,
  };

  webhookEvents.set(id, webhookEvent);
  return webhookEvent;
}

/**
 * Get queued webhooks for retry
 */
export function getQueuedWebhooks(limit: number = 50): WebhookEvent[] {
  return Array.from(webhookEvents.values())
    .filter(event => !event.processed && event.retryCount < 3)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, limit);
}

/**
 * Retry a failed webhook
 */
export function retryWebhook(eventId: string): WebhookVerificationResult | null {
  const event = webhookEvents.get(eventId);
  if (!event || event.processed || event.retryCount >= 3) {
    return null;
  }

  // Increment retry count
  event.retryCount += 1;
  webhookEvents.set(eventId, event);

  // Attempt verification again
  const result = verifyWebhookSignature({
    signature: event.signature,
    timestamp: event.timestamp,
    body: JSON.stringify(event.payload),
    provider: event.provider,
  });

  if (result.isValid) {
    event.verified = true;
    event.processed = true;
    event.processedAt = new Date().toISOString();
    event.error = undefined;
    webhookEvents.set(eventId, event);
  } else {
    event.error = result.error;
    webhookEvents.set(eventId, event);
  }

  return result;
}

/**
 * Mark webhook as processed
 */
export function markWebhookProcessed(eventId: string): boolean {
  const event = webhookEvents.get(eventId);
  if (event) {
    event.processed = true;
    event.processedAt = new Date().toISOString();
    webhookEvents.set(eventId, event);
    return true;
  }
  return false;
}

/**
 * Get webhook events (for admin)
 */
export function getWebhookEvents(limit: number = 100): WebhookEvent[] {
  return Array.from(webhookEvents.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/**
 * Clear all webhook secrets (for testing)
 */
export function clearWebhookSecrets(): void {
  webhookSecrets.clear();
}

/**
 * Clear all webhook events (for testing)
 */
export function clearWebhookEvents(): void {
  webhookEvents.clear();
}

/**
 * Initialize default webhook secrets (for development)
 */
export function initializeDefaultSecrets(): void {
  // Only initialize if no secrets exist
  if (webhookSecrets.size === 0) {
    createWebhookSecret('stripe', 'whsec_test_default_stripe_secret_key_32_chars_min');
    createWebhookSecret('paypal', 'whsec_test_default_paypal_secret_key_32_chars_min');
    createWebhookSecret('github', 'whsec_test_default_github_secret_key_32_chars_min');
    createWebhookSecret('custom', 'whsec_test_default_custom_secret_key_32_chars_min');
  }
}

// Initialize defaults
initializeDefaultSecrets();