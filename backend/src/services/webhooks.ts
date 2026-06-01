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

  // Per-endpoint rate limiting
  const rateCheck = checkEndpointRateLimit(config.url);
  if (!rateCheck.allowed) {
    return { accepted: false, reason: `Rate limit exceeded for endpoint. Retry in ${Math.ceil(rateCheck.info.resetInMs / 1000)}s` };
  }

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

// ── Delivery Analytics ────────────────────────────────────────────────────────

export interface WebhookAnalytics {
  totalDeliveries: number;
  delivered: number;
  failed: number;
  pending: number;
  deadLetter: number;
  successRate: number;
  avgLatencyMs: number;
  avgPayloadSizeBytes: number;
  byStatus: Record<string, number>;
  recentDeliveries: Array<{
    id: string;
    status: WebhookDeliveryStatus;
    attempt: number;
    statusCode?: number;
    latencyMs?: number;
    payloadSizeBytes: number;
    createdAt: string;
  }>;
}

export function getWebhookAnalytics(): WebhookAnalytics {
  const all = Array.from(deliveries.values());
  const byStatus: Record<string, number> = {};
  let deliveredCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  let deadLetterCount = 0;
  let totalLatency = 0;
  let latencySamples = 0;
  let totalPayloadSize = 0;

  for (const d of all) {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    const payloadSize = (d.responseBody ?? '').length;
    totalPayloadSize += payloadSize;

    switch (d.status) {
      case 'delivered':
        deliveredCount++;
        if (d.deliveredAt && d.createdAt) {
          const latency = new Date(d.deliveredAt).getTime() - new Date(d.createdAt).getTime();
          totalLatency += latency;
          latencySamples++;
        }
        break;
      case 'failed':
      case 'dead_letter':
        failedCount++;
        if (d.status === 'dead_letter') deadLetterCount++;
        break;
      case 'pending':
      case 'processing':
      case 'retrying':
        pendingCount++;
        break;
    }
  }

  const total = all.length;
  const successRate = total > 0 ? (deliveredCount / total) * 100 : 0;
  const avgLatencyMs = latencySamples > 0 ? totalLatency / latencySamples : 0;
  const avgPayloadSizeBytes = total > 0 ? totalPayloadSize / total : 0;

  const recentDeliveries = all
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .map((d) => {
      let latencyMs: number | undefined;
      if (d.deliveredAt && d.createdAt) {
        latencyMs = new Date(d.deliveredAt).getTime() - new Date(d.createdAt).getTime();
      }
      return {
        id: d.id,
        status: d.status,
        attempt: d.attempt,
        statusCode: d.statusCode,
        latencyMs,
        payloadSizeBytes: (d.responseBody ?? '').length,
        createdAt: d.createdAt,
      };
    });

  return {
    totalDeliveries: total,
    delivered: deliveredCount,
    failed: failedCount,
    pending: pendingCount,
    deadLetter: deadLetterCount,
    successRate: Math.round(successRate * 100) / 100,
    avgLatencyMs: Math.round(avgLatencyMs),
    avgPayloadSizeBytes: Math.round(avgPayloadSizeBytes),
    byStatus,
    recentDeliveries,
  };
}

// ── Per-endpoint Rate Limiting ────────────────────────────────────────────────

const ENDPOINT_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const ENDPOINT_RATE_LIMIT_MAX = 60; // 60 events per minute per endpoint

interface EndpointRateLimitState {
  count: number;
  windowStart: number;
}

const endpointRateLimits = new Map<string, EndpointRateLimitState>();

export interface EndpointRateLimitInfo {
  url: string;
  count: number;
  limit: number;
  remaining: number;
  resetInMs: number;
}

function checkEndpointRateLimit(configUrl: string): { allowed: boolean; info: EndpointRateLimitInfo } {
  const now = Date.now();
  let state = endpointRateLimits.get(configUrl);

  if (!state || now - state.windowStart >= ENDPOINT_RATE_LIMIT_WINDOW_MS) {
    state = { count: 0, windowStart: now };
    endpointRateLimits.set(configUrl, state);
  }

  state.count++;
  const remaining = Math.max(0, ENDPOINT_RATE_LIMIT_MAX - state.count);
  const resetInMs = ENDPOINT_RATE_LIMIT_WINDOW_MS - (now - state.windowStart);

  return {
    allowed: state.count <= ENDPOINT_RATE_LIMIT_MAX,
    info: {
      url: configUrl,
      count: state.count,
      limit: ENDPOINT_RATE_LIMIT_MAX,
      remaining,
      resetInMs,
    },
  };
}

export function getEndpointRateLimits(): EndpointRateLimitInfo[] {
  const now = Date.now();
  const results: EndpointRateLimitInfo[] = [];
  for (const [url, state] of endpointRateLimits) {
    const elapsed = now - state.windowStart;
    if (elapsed < ENDPOINT_RATE_LIMIT_WINDOW_MS) {
      results.push({
        url,
        count: state.count,
        limit: ENDPOINT_RATE_LIMIT_MAX,
        remaining: Math.max(0, ENDPOINT_RATE_LIMIT_MAX - state.count),
        resetInMs: ENDPOINT_RATE_LIMIT_WINDOW_MS - elapsed,
      });
    }
  }
  return results;
}

// ── Webhook Test Endpoint ─────────────────────────────────────────────────────

const SAMPLE_PAYLOADS: Record<string, Record<string, unknown>> = {
  'payment.completed': {
    event: 'payment.completed',
    paymentId: 'pay_test_001',
    amount: '100.00',
    currency: 'USD',
    recipient: 'merchant_abc',
    status: 'completed',
    timestamp: new Date().toISOString(),
  },
  'payment.failed': {
    event: 'payment.failed',
    paymentId: 'pay_test_002',
    amount: '50.00',
    currency: 'USD',
    recipient: 'merchant_abc',
    status: 'failed',
    reason: 'Insufficient funds',
    timestamp: new Date().toISOString(),
  },
  'payment.disputed': {
    event: 'payment.disputed',
    paymentId: 'pay_test_003',
    amount: '75.00',
    currency: 'USD',
    recipient: 'merchant_abc',
    status: 'disputed',
    disputeId: 'dsp_test_001',
    reason: 'Unauthorized transaction',
    timestamp: new Date().toISOString(),
  },
};

export function getSamplePayloads(): Record<string, Record<string, unknown>> {
  return { ...SAMPLE_PAYLOADS };
}

export async function sendWebhookTest(input: {
  merchantId: string;
  eventType?: string;
}): Promise<{ success: boolean; statusCode?: number; responseBody?: string; error?: string }> {
  const config = Array.from(webhookConfigs.values()).find(
    (x) => x.merchantId === input.merchantId && x.enabled
  );
  if (!config) {
    return { success: false, error: 'No enabled webhook config for merchant' };
  }

  const eventType = input.eventType ?? 'payment.completed';
  const samplePayload = SAMPLE_PAYLOADS[eventType] ?? SAMPLE_PAYLOADS['payment.completed'];
  const body = JSON.stringify({ test: true, ...samplePayload });
  const signature = buildSignature(config.currentSecret, body);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Test': 'true',
        'X-Webhook-Event-Id': `test_${randomUUID()}`,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const responseText = await response.text().catch(() => '');
    return { success: response.ok, statusCode: response.status, responseBody: responseText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
