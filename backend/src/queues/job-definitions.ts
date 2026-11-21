/**
 * Issue #488 — Domain job definitions
 *
 * Declarative job catalogue for payment, notification, and webhook domains.
 * Import `domainJobs` and register each entry with BullMQJobRegistry.
 */

import type { QueueJobDefinition } from './types.js';

// ── Payment jobs ──────────────────────────────────────────────────────────────

export const processPaymentJob: QueueJobDefinition<{ paymentId: string; amount: number }> = {
  name: 'process-payment',
  queue: 'payments',
  concurrency: 5,
  retry: { maxAttempts: 3, backoff: { type: 'exponential', delay: 2000 }, deadLetterQueue: 'payments-dlq' },
  timeoutMs: 30_000,
  handler: async ({ paymentId, amount }) => {
    // Stub: delegate to payment service
    console.log(`[jobs] processing payment ${paymentId} amount=${amount}`);
  },
};

export const syncPaymentStatusJob: QueueJobDefinition<{ paymentId: string }> = {
  name: 'sync-payment-status',
  queue: 'payments',
  concurrency: 10,
  retry: { maxAttempts: 5, backoff: { type: 'exponential', delay: 1000 } },
  timeoutMs: 15_000,
  handler: async ({ paymentId }) => {
    console.log(`[jobs] syncing payment status for ${paymentId}`);
  },
};

// ── Notification jobs ─────────────────────────────────────────────────────────

export const sendNotificationJob: QueueJobDefinition<{
  userId: string;
  channel: 'email' | 'push' | 'sms';
  template: string;
  data: Record<string, unknown>;
}> = {
  name: 'send-notification',
  queue: 'notifications',
  concurrency: 20,
  retry: { maxAttempts: 3, backoff: { type: 'exponential', delay: 500 } },
  timeoutMs: 10_000,
  handler: async ({ userId, channel, template }) => {
    console.log(`[jobs] sending ${channel} notification to ${userId} via template "${template}"`);
  },
};

// ── Webhook jobs ──────────────────────────────────────────────────────────────

export const deliverWebhookJob: QueueJobDefinition<{
  webhookId: string;
  url: string;
  payload: unknown;
}> = {
  name: 'deliver-webhook',
  queue: 'webhooks',
  concurrency: 10,
  retry: { maxAttempts: 5, backoff: { type: 'exponential', delay: 3000 }, deadLetterQueue: 'webhooks-dlq' },
  timeoutMs: 20_000,
  handler: async ({ webhookId, url, payload }) => {
    console.log(`[jobs] delivering webhook ${webhookId} to ${url}`, payload);
  },
};

export const domainJobs: QueueJobDefinition[] = [
  processPaymentJob as QueueJobDefinition,
  syncPaymentStatusJob as QueueJobDefinition,
  sendNotificationJob as QueueJobDefinition,
  deliverWebhookJob as QueueJobDefinition,
];
