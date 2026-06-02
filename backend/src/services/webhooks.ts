import { createHmac, randomUUID } from 'node:crypto';

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

function buildSignature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function upsertWebhookConfig(input: {
  merchantId: string;
  url: string;
  secret: string;
  enabled?: boolean;
}): MerchantWebhookConfig {
  const existing = Array.from(webhookConfigs.values()).find((x) => x.merchantId === input.merchantId);
  const ts = nowIso();

  if (existing) {
    existing.url = input.url;
    existing.currentSecret = input.secret;
    existing.enabled = input.enabled ?? true;
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

  const body = delivery.responseBody ?? '{}';
  const signature = buildSignature(config.currentSecret, body);
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
        'X-Webhook-Signature': signature,
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
