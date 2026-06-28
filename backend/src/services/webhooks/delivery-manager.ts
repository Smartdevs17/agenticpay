/**
 * Enhanced Webhook Delivery Manager
 *
 * Provides configurable retry policies per endpoint, delivery logs with
 * status/latency/payload preview, success-rate alerting, and CSV export.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeliveryStatus =
  | 'pending'
  | 'processing'
  | 'delivered'
  | 'retrying'
  | 'failed'
  | 'dead_letter'
  | 'expired';

export type FailureCategory =
  | 'invalid_endpoint'
  | 'bad_signature'
  | 'rate_limited'
  | 'timeout'
  | 'http_error'
  | 'ssl_error'
  | 'payload_too_large'
  | 'unknown';

export interface RetryPolicy {
  maxRetries: number;
  backoffMultiplier: number;     // e.g. 2 → exponential doubling
  initialDelayMs: number;
  timeoutMs: number;
  windowDays: number;            // discard after this many days
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  backoffMultiplier: 2,
  initialDelayMs: 1_000,
  timeoutMs: 10_000,
  windowDays: 7,
};

export interface WebhookEndpointConfig {
  id: string;
  merchantId: string;
  url: string;
  secret: string;
  enabled: boolean;
  retryPolicy: RetryPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryLog {
  id: string;
  endpointId: string;
  merchantId: string;
  eventId: string;
  eventType: string;
  payloadPreview: string;       // first 256 chars of JSON payload
  status: DeliveryStatus;
  attempt: number;
  statusCode?: number;
  responseLatencyMs?: number;
  lastError?: string;
  failureCategory?: FailureCategory;
  nextAttemptAt?: string;
  deliveredAt?: string;
  expiredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryHealthSummary {
  totalDeliveries: number;
  deliveredCount: number;
  failedCount: number;
  deadLetterCount: number;
  successRatePct: number;
  averageLatencyMs: number;
  failureBreakdown: Record<FailureCategory, number>;
  alertTriggered: boolean;       // true when success rate < 99%
}

// ---------------------------------------------------------------------------
// In-memory stores (swap for Prisma/Redis in production)
// ---------------------------------------------------------------------------

const endpoints = new Map<string, WebhookEndpointConfig>();
export const deliveryLogs = new Map<string, DeliveryLog>();

// ---------------------------------------------------------------------------
// Endpoint management
// ---------------------------------------------------------------------------

export function registerEndpoint(
  config: Omit<WebhookEndpointConfig, 'id' | 'createdAt' | 'updatedAt'>
): WebhookEndpointConfig {
  const now = new Date().toISOString();
  const endpoint: WebhookEndpointConfig = {
    ...config,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  endpoints.set(endpoint.id, endpoint);
  return endpoint;
}

export function updateEndpointRetryPolicy(
  endpointId: string,
  policy: Partial<RetryPolicy>
): WebhookEndpointConfig {
  const ep = endpoints.get(endpointId);
  if (!ep) throw new Error(`Endpoint ${endpointId} not found`);
  ep.retryPolicy = { ...ep.retryPolicy, ...policy };
  ep.updatedAt = new Date().toISOString();
  return ep;
}

export function getEndpoint(id: string): WebhookEndpointConfig | undefined {
  return endpoints.get(id);
}

export function listEndpoints(merchantId?: string): WebhookEndpointConfig[] {
  const all = Array.from(endpoints.values());
  return merchantId ? all.filter((e) => e.merchantId === merchantId) : all;
}

// ---------------------------------------------------------------------------
// Delivery scheduling
// ---------------------------------------------------------------------------

export function scheduleDelivery(
  endpointId: string,
  merchantId: string,
  eventId: string,
  eventType: string,
  payload: Record<string, unknown>
): DeliveryLog {
  const endpoint = endpoints.get(endpointId);
  if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);

  const payloadJson = JSON.stringify(payload);
  const now = new Date().toISOString();

  const log: DeliveryLog = {
    id: randomUUID(),
    endpointId,
    merchantId,
    eventId,
    eventType,
    payloadPreview: payloadJson.slice(0, 256),
    status: 'pending',
    attempt: 0,
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
  };

  deliveryLogs.set(log.id, log);
  return log;
}

// ---------------------------------------------------------------------------
// Delivery simulation (HTTP dispatch with retry logic)
// ---------------------------------------------------------------------------

function classifyError(err: Error | string, statusCode?: number): FailureCategory {
  const msg = typeof err === 'string' ? err.toLowerCase() : err.message.toLowerCase();
  if (statusCode === 429) return 'rate_limited';
  if (statusCode && statusCode >= 400 && statusCode < 500) return 'invalid_endpoint';
  if (msg.includes('ssl') || msg.includes('certificate')) return 'ssl_error';
  if (msg.includes('timeout') || msg.includes('abort')) return 'timeout';
  if (msg.includes('payload') || msg.includes('size')) return 'payload_too_large';
  if (statusCode && statusCode >= 500) return 'http_error';
  return 'unknown';
}

function nextDelay(policy: RetryPolicy, attempt: number): number {
  return policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt);
}

function isExpired(log: DeliveryLog, policy: RetryPolicy): boolean {
  const createdMs = new Date(log.createdAt).getTime();
  return Date.now() - createdMs > policy.windowDays * 86_400_000;
}

export async function attemptDelivery(
  logId: string,
  _fetchFn?: (url: string, opts: RequestInit) => Promise<{ status: number; text: () => Promise<string> }>
): Promise<DeliveryLog> {
  const log = deliveryLogs.get(logId);
  if (!log) throw new Error(`Delivery log ${logId} not found`);

  const endpoint = endpoints.get(log.endpointId);
  if (!endpoint) throw new Error(`Endpoint ${log.endpointId} not found`);

  const policy = endpoint.retryPolicy;

  if (isExpired(log, policy)) {
    log.status = 'expired';
    log.expiredAt = new Date().toISOString();
    log.updatedAt = log.expiredAt;
    deliveryLogs.set(logId, log);
    return log;
  }

  log.status = 'processing';
  log.attempt += 1;
  log.updatedAt = new Date().toISOString();

  const startMs = Date.now();

  try {
    // Use injected fetch or global fetch
    const fetcher = _fetchFn ?? (fetch as typeof _fetchFn);
    if (!fetcher) throw new Error('No fetch implementation available');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);

    const response = await fetcher(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Event-Id': log.eventId },
      body: log.payloadPreview,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    log.responseLatencyMs = Date.now() - startMs;
    log.statusCode = response.status;

    if (response.status >= 200 && response.status < 300) {
      log.status = 'delivered';
      log.deliveredAt = new Date().toISOString();
      log.nextAttemptAt = undefined;
    } else {
      handleRetryOrDead(log, policy, classifyError('', response.status), response.status);
    }
  } catch (err: unknown) {
    log.responseLatencyMs = Date.now() - startMs;
    const error = err instanceof Error ? err : new Error(String(err));
    log.lastError = error.message;
    handleRetryOrDead(log, policy, classifyError(error));
  }

  log.updatedAt = new Date().toISOString();
  deliveryLogs.set(logId, log);
  return log;
}

function handleRetryOrDead(
  log: DeliveryLog,
  policy: RetryPolicy,
  category: FailureCategory,
  statusCode?: number
): void {
  log.failureCategory = category;
  if (statusCode) log.statusCode = statusCode;

  if (log.attempt >= policy.maxRetries) {
    log.status = 'dead_letter';
    log.nextAttemptAt = undefined;
  } else {
    log.status = 'retrying';
    log.nextAttemptAt = new Date(Date.now() + nextDelay(policy, log.attempt)).toISOString();
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getDeliveryLog(id: string): DeliveryLog | undefined {
  return deliveryLogs.get(id);
}

export function listDeliveryLogs(
  filters: { endpointId?: string; merchantId?: string; status?: DeliveryStatus } = {}
): DeliveryLog[] {
  return Array.from(deliveryLogs.values()).filter((l) => {
    if (filters.endpointId && l.endpointId !== filters.endpointId) return false;
    if (filters.merchantId && l.merchantId !== filters.merchantId) return false;
    if (filters.status && l.status !== filters.status) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Health dashboard
// ---------------------------------------------------------------------------

export function getDeliveryHealth(merchantId?: string): DeliveryHealthSummary {
  const logs = listDeliveryLogs(merchantId ? { merchantId } : {});
  const total = logs.length;
  const delivered = logs.filter((l) => l.status === 'delivered').length;
  const failed = logs.filter((l) => l.status === 'failed').length;
  const deadLetter = logs.filter((l) => l.status === 'dead_letter').length;
  const successRate = total > 0 ? (delivered / total) * 100 : 100;

  const latencies = logs.filter((l) => l.responseLatencyMs != null).map((l) => l.responseLatencyMs!);
  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  const failureBreakdown: Record<FailureCategory, number> = {
    invalid_endpoint: 0,
    bad_signature: 0,
    rate_limited: 0,
    timeout: 0,
    http_error: 0,
    ssl_error: 0,
    payload_too_large: 0,
    unknown: 0,
  };

  for (const log of logs) {
    if (log.failureCategory) {
      failureBreakdown[log.failureCategory] = (failureBreakdown[log.failureCategory] ?? 0) + 1;
    }
  }

  return {
    totalDeliveries: total,
    deliveredCount: delivered,
    failedCount: failed,
    deadLetterCount: deadLetter,
    successRatePct: successRate,
    averageLatencyMs: avgLatency,
    failureBreakdown,
    alertTriggered: successRate < 99,
  };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export function exportDeliveryLogsCSV(merchantId?: string): string {
  const logs = listDeliveryLogs(merchantId ? { merchantId } : {});
  const header = [
    'id',
    'endpointId',
    'eventId',
    'eventType',
    'status',
    'attempt',
    'statusCode',
    'responseLatencyMs',
    'failureCategory',
    'deliveredAt',
    'createdAt',
  ].join(',');

  const rows = logs.map((l) =>
    [
      l.id,
      l.endpointId,
      l.eventId,
      l.eventType,
      l.status,
      l.attempt,
      l.statusCode ?? '',
      l.responseLatencyMs ?? '',
      l.failureCategory ?? '',
      l.deliveredAt ?? '',
      l.createdAt,
    ].join(',')
  );

  return [header, ...rows].join('\n');
}
