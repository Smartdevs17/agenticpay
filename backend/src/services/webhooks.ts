import { randomUUID } from 'node:crypto';
import { encryptWebhookPayload } from './webhooks/encryption.js';
import {
  signWebhookPayload,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from './webhooks/signer.js';

export type WebhookDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'retrying'
  | 'delivered'
  | 'failed'
  | 'dead_letter';

export interface MerchantWebhookConfig {
  id: string;
  merchantId: string;
  url: string;
  enabled: boolean;
  currentSecret: string;
  previousSecrets: string[];
  signatureVersion: string;
  secretExpiresAt: string;
  encryptionPublicKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentWebhookEvent {
  eventId: string;
  merchantId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WebhookDeliveryLog {
  id: string;
  configId: string;
  merchantId: string;
  eventId: string;
  idempotencyKey: string;
  status: WebhookDeliveryStatus;
  attempt: number;
  maxAttempts: number;
  statusCode?: number;
  responseBody?: string;
  lastError?: string;
  nextAttemptAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

type WorkerState = {
  timer?: NodeJS.Timeout;
  running: boolean;
};

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
const ATTEMPT_TIMEOUT_MS = 8_000;

const webhookConfigs = new Map<string, MerchantWebhookConfig>();
const deliveries = new Map<string, WebhookDeliveryLog>();
const idempotencyIndex = new Map<string, string>();
const deadLetterQueue: WebhookDeliveryLog[] = [];

const worker: WorkerState = { running: false };

function nowIso(): string {
  return new Date().toISOString();
}

function computeBackoffDelay(attempt: number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);
  const jitter = Math.floor(Math.random() * 250);
  return exponential + jitter;
}

export function upsertWebhookConfig(input: {
  merchantId: string;
  url: string;
  secret: string;
  enabled?: boolean;
  encryptionPublicKey?: string;
}): MerchantWebhookConfig {
  const existing = Array.from(webhookConfigs.values()).find((x) => x.merchantId === input.merchantId);
  const ts = nowIso();

  if (existing) {
    existing.url = input.url;
    existing.currentSecret = input.secret;
    existing.enabled = input.enabled ?? true;
    existing.signatureVersion = 'v1';
    existing.secretExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    existing.encryptionPublicKey = input.encryptionPublicKey;
    existing.updatedAt = ts;
    webhookConfigs.set(existing.id, existing);
    return existing;
  }

  const config: MerchantWebhookConfig = {
    id: `whcfg_${randomUUID()}`,
    merchantId: input.merchantId,
    url: input.url,
    enabled: input.enabled ?? true,
    currentSecret: input.secret,
    previousSecrets: [],
    signatureVersion: 'v1',
    secretExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    encryptionPublicKey: input.encryptionPublicKey,
    createdAt: ts,
    updatedAt: ts,
  };
  webhookConfigs.set(config.id, config);
  return config;
}

export function rotateWebhookSecret(configId: string, nextSecret: string): MerchantWebhookConfig | undefined {
  const config = webhookConfigs.get(configId);
  if (!config) return undefined;
  config.previousSecrets.unshift(config.currentSecret);
  config.previousSecrets = config.previousSecrets.slice(0, 5);
  config.currentSecret = nextSecret;
  config.signatureVersion = 'v1';
  config.secretExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  config.updatedAt = nowIso();
  webhookConfigs.set(config.id, config);
  return config;
}

export function listWebhookConfigs(): MerchantWebhookConfig[] {
  return Array.from(webhookConfigs.values());
}

export function enqueueWebhookEvent(input: {
  merchantId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}): { accepted: boolean; delivery?: WebhookDeliveryLog; reason?: string } {
  const config = Array.from(webhookConfigs.values()).find(
    (x) => x.merchantId === input.merchantId && x.enabled
  );
  if (!config) return { accepted: false, reason: 'No enabled webhook config for merchant' };

  const eventId = `whev_${randomUUID()}`;
  const event: PaymentWebhookEvent = {
    eventId,
    merchantId: input.merchantId,
    type: input.type,
    payload: input.payload,
    createdAt: nowIso(),
  };
  const dedupeKey = input.idempotencyKey ?? `${config.id}:${eventId}:${input.type}`;
  if (idempotencyIndex.has(dedupeKey)) {
    const existingDelivery = deliveries.get(idempotencyIndex.get(dedupeKey)!);
    return { accepted: false, reason: 'Duplicate idempotency key', delivery: existingDelivery };
  }

  const delivery: WebhookDeliveryLog = {
    id: `whdel_${randomUUID()}`,
    configId: config.id,
    merchantId: input.merchantId,
    eventId: event.eventId,
    idempotencyKey: dedupeKey,
    status: 'pending',
    attempt: 0,
    maxAttempts: MAX_ATTEMPTS,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    nextAttemptAt: nowIso(),
    responseBody: JSON.stringify(event),
  };

  deliveries.set(delivery.id, delivery);
  idempotencyIndex.set(dedupeKey, delivery.id);
  return { accepted: true, delivery };
}

async function deliverOne(delivery: WebhookDeliveryLog): Promise<void> {
  const config = webhookConfigs.get(delivery.configId);
  if (!config || !config.enabled) {
    delivery.status = 'failed';
    delivery.lastError = 'Webhook config missing or disabled';
    delivery.updatedAt = nowIso();
    deliveries.set(delivery.id, delivery);
    return;
  }

  let originalEvent: PaymentWebhookEvent | undefined;
  try {
    originalEvent = delivery.responseBody ? JSON.parse(delivery.responseBody) as PaymentWebhookEvent : undefined;
  } catch {
    originalEvent = {
      eventId: delivery.eventId,
      merchantId: delivery.merchantId,
      type: 'webhook.retry',
      payload: {},
      createdAt: delivery.createdAt,
    };
  }
  const signed = signWebhookPayload({
    payload: originalEvent ? { ...originalEvent, payload: originalEvent.payload } : {},
    secret: config.currentSecret,
    version: config.signatureVersion,
    eventId: delivery.eventId,
  });
  const body = encryptWebhookPayload(signed.body, config.encryptionPublicKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

  delivery.attempt += 1;
  delivery.status = 'processing';
  delivery.updatedAt = nowIso();

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: signed.signature,
        [WEBHOOK_TIMESTAMP_HEADER]: signed.timestamp,
        'X-AgenticPay-Signature-Version': signed.version,
        'X-AgenticPay-Event-Id': delivery.eventId,
        'X-Webhook-Idempotency-Key': delivery.idempotencyKey,
        'X-Webhook-Event-Id': delivery.eventId,
      },
      body,
      signal: controller.signal,
    });

    const responseText = await response.text().catch(() => '');
    delivery.statusCode = response.status;
    delivery.responseBody = responseText;

    if (response.ok) {
      delivery.status = 'delivered';
      delivery.deliveredAt = nowIso();
      delivery.nextAttemptAt = undefined;
    } else if (delivery.attempt >= delivery.maxAttempts) {
      delivery.status = 'dead_letter';
      delivery.lastError = `HTTP ${response.status}`;
      delivery.nextAttemptAt = undefined;
      deadLetterQueue.push({ ...delivery });
    } else {
      delivery.status = 'retrying';
      delivery.lastError = `HTTP ${response.status}`;
      delivery.nextAttemptAt = new Date(Date.now() + computeBackoffDelay(delivery.attempt)).toISOString();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (delivery.attempt >= delivery.maxAttempts) {
      delivery.status = 'dead_letter';
      delivery.lastError = message;
      delivery.nextAttemptAt = undefined;
      deadLetterQueue.push({ ...delivery });
    } else {
      delivery.status = 'retrying';
      delivery.lastError = message;
      delivery.nextAttemptAt = new Date(Date.now() + computeBackoffDelay(delivery.attempt)).toISOString();
    }
  } finally {
    clearTimeout(timeout);
    delivery.updatedAt = nowIso();
    deliveries.set(delivery.id, delivery);
  }
}

async function processDueDeliveries(): Promise<void> {
  const now = Date.now();
  const due = Array.from(deliveries.values()).filter((d) => {
    if (d.status !== 'pending' && d.status !== 'retrying') return false;
    if (!d.nextAttemptAt) return false;
    return new Date(d.nextAttemptAt).getTime() <= now;
  });

  for (const delivery of due) {
    await deliverOne(delivery);
  }
}

export function startWebhookWorker(): void {
  if (worker.running) return;
  worker.running = true;
  worker.timer = setInterval(() => {
    void processDueDeliveries();
  }, 1_000);
}

export function stopWebhookWorker(): void {
  if (worker.timer) clearInterval(worker.timer);
  worker.timer = undefined;
  worker.running = false;
}

export function listWebhookDeliveries(): WebhookDeliveryLog[] {
  return Array.from(deliveries.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getWebhookDelivery(id: string): WebhookDeliveryLog | undefined {
  return deliveries.get(id);
}

export function retryWebhookDeliveryManually(id: string): WebhookDeliveryLog | undefined {
  const item = deliveries.get(id);
  if (!item) return undefined;
  if (item.status === 'delivered') return item;
  item.status = 'pending';
  item.attempt = 0;
  item.lastError = undefined;
  item.nextAttemptAt = nowIso();
  item.updatedAt = nowIso();
  deliveries.set(item.id, item);
  return item;
}

export function listDeadLetterQueue(): WebhookDeliveryLog[] {
  return [...deadLetterQueue];
}
