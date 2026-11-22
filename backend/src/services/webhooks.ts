import { createHmac, randomUUID } from 'node:crypto';
import { logger as defaultLoggerInstance } from '../utils/logger.js';
import {
  prepareWebhookPayload,
  webhookMetrics,
  DEFAULT_COMPRESSION_MIN_BYTES,
  DEFAULT_MAX_PAYLOAD_BYTES,
  type PreparedPayload,
} from './webhooks/compression.js';
import {
  ShardedDispatcher,
  readShardDispatcherOptions,
  shardKeyForUrl,
  UNPARSEABLE_URL_SHARD,
  type DispatchPassResult,
  type DispatchStatsSnapshot,
  type ShardDispatcherOptions,
} from './webhooks/shard-dispatcher.js';

export { webhookMetrics, prepareWebhookPayload };

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
  compressPayloads?: boolean;
  compressionMinBytes?: number;
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
  payload?: string;
  isCompressed?: boolean;
  rawBytes?: number;
  compressedBytes?: number;
  lastError?: string;
  nextAttemptAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const MAX_ATTEMPTS = 5;
export const BASE_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 60_000;
export const ATTEMPT_TIMEOUT_MS = 8_000;

/* =====================================================
   Dependency Injection Interfaces (Issue #1410)
===================================================== */

export interface IWebhookStore {
  getConfig(id: string): MerchantWebhookConfig | undefined;
  findConfigByMerchantId(merchantId: string): MerchantWebhookConfig | undefined;
  saveConfig(config: MerchantWebhookConfig): void;
  listConfigs(): MerchantWebhookConfig[];

  getDelivery(id: string): WebhookDeliveryLog | undefined;
  saveDelivery(delivery: WebhookDeliveryLog): void;
  listDeliveries(): WebhookDeliveryLog[];
  findDueDeliveries(now?: number): WebhookDeliveryLog[];

  getIdempotencyDeliveryId(key: string): string | undefined;
  setIdempotency(key: string, deliveryId: string): void;

  addToDeadLetter(delivery: WebhookDeliveryLog): void;
  listDeadLetter(): WebhookDeliveryLog[];

  clear?(): void;
}

export interface IWebhookTransportResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  text(): Promise<string>;
}

export interface IWebhookTransport {
  send(
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body: string | Buffer;
      timeoutMs: number;
      signal?: AbortSignal;
    }
  ): Promise<IWebhookTransportResponse>;
}

export interface IClock {
  now(): number;
  nowIso(): string;
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout;
  clearTimeout(timeoutId: NodeJS.Timeout): void;
  setInterval(callback: () => void, ms: number): NodeJS.Timeout;
  clearInterval(intervalId: NodeJS.Timeout): void;
}

export interface IWebhookLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/* =====================================================
   Default Implementations
===================================================== */

export class InMemoryWebhookStore implements IWebhookStore {
  private readonly webhookConfigs = new Map<string, MerchantWebhookConfig>();
  private readonly deliveries = new Map<string, WebhookDeliveryLog>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly deadLetterQueue: WebhookDeliveryLog[] = [];

  getConfig(id: string): MerchantWebhookConfig | undefined {
    return this.webhookConfigs.get(id);
  }

  findConfigByMerchantId(merchantId: string): MerchantWebhookConfig | undefined {
    return Array.from(this.webhookConfigs.values()).find((x) => x.merchantId === merchantId);
  }

  saveConfig(config: MerchantWebhookConfig): void {
    this.webhookConfigs.set(config.id, config);
  }

  listConfigs(): MerchantWebhookConfig[] {
    return Array.from(this.webhookConfigs.values());
  }

  getDelivery(id: string): WebhookDeliveryLog | undefined {
    return this.deliveries.get(id);
  }

  saveDelivery(delivery: WebhookDeliveryLog): void {
    this.deliveries.set(delivery.id, delivery);
  }

  listDeliveries(): WebhookDeliveryLog[] {
    return Array.from(this.deliveries.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  findDueDeliveries(now = Date.now()): WebhookDeliveryLog[] {
    return Array.from(this.deliveries.values()).filter((d) => {
      if (d.status !== 'pending' && d.status !== 'retrying') return false;
      if (!d.nextAttemptAt) return false;
      return new Date(d.nextAttemptAt).getTime() <= now;
    });
  }

  getIdempotencyDeliveryId(key: string): string | undefined {
    return this.idempotencyIndex.get(key);
  }

  setIdempotency(key: string, deliveryId: string): void {
    this.idempotencyIndex.set(key, deliveryId);
  }

  addToDeadLetter(delivery: WebhookDeliveryLog): void {
    this.deadLetterQueue.push({ ...delivery });
  }

  listDeadLetter(): WebhookDeliveryLog[] {
    return [...this.deadLetterQueue];
  }

  clear(): void {
    this.webhookConfigs.clear();
    this.deliveries.clear();
    this.idempotencyIndex.clear();
    this.deadLetterQueue.length = 0;
  }
}

export class FetchWebhookTransport implements IWebhookTransport {
  async send(
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body: string | Buffer;
      timeoutMs: number;
      signal?: AbortSignal;
    }
  ): Promise<IWebhookTransportResponse> {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;

    if (options.timeoutMs > 0) {
      timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
    }

    const onExternalAbort = () => controller.abort(options.signal?.reason);
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    try {
      const response = await fetch(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text: () => response.text(),
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export class SystemClock implements IClock {
  now(): number {
    return Date.now();
  }
  nowIso(): string {
    return new Date().toISOString();
  }
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout {
    return setTimeout(callback, ms);
  }
  clearTimeout(timeoutId: NodeJS.Timeout): void {
    clearTimeout(timeoutId);
  }
  setInterval(callback: () => void, ms: number): NodeJS.Timeout {
    return setInterval(callback, ms);
  }
  clearInterval(intervalId: NodeJS.Timeout): void {
    clearInterval(intervalId);
  }
}

export class SystemWebhookLogger implements IWebhookLogger {
  info(message: string, meta?: Record<string, unknown>): void {
    defaultLoggerInstance.info(message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    defaultLoggerInstance.warn(message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    defaultLoggerInstance.error(message, meta);
  }
}

/* =====================================================
   Typed Webhook Service with DI (Issue #1410)
===================================================== */

export interface WebhookServiceDependencies {
  store: IWebhookStore;
  transport: IWebhookTransport;
  clock?: IClock;
  logger?: IWebhookLogger;
  dispatcherOptions?: ShardDispatcherOptions;
  jitterFn?: () => number;
}

export class WebhookRetryService {
  private readonly store: IWebhookStore;
  private readonly transport: IWebhookTransport;
  private readonly clock: IClock;
  private readonly logger: IWebhookLogger;
  private readonly jitterFn: () => number;
  private dispatcher?: ShardedDispatcher<WebhookDeliveryLog>;
  private workerTimer?: NodeJS.Timeout;
  private workerRunning = false;
  private readonly customDispatcherOptions?: ShardDispatcherOptions;

  constructor(deps: WebhookServiceDependencies) {
    this.store = deps.store;
    this.transport = deps.transport;
    this.clock = deps.clock ?? new SystemClock();
    this.logger = deps.logger ?? new SystemWebhookLogger();
    this.jitterFn = deps.jitterFn ?? (() => Math.floor(Math.random() * 250));
    this.customDispatcherOptions = deps.dispatcherOptions;
  }

  computeBackoffDelay(attempt: number): number {
    const exponential = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);
    const jitter = this.jitterFn();
    return exponential + jitter;
  }

  upsertConfig(input: {
    merchantId: string;
    url: string;
    secret: string;
    enabled?: boolean;
    compressPayloads?: boolean;
    compressionMinBytes?: number;
  }): MerchantWebhookConfig {
    const existing = this.store.findConfigByMerchantId(input.merchantId);
    const ts = this.clock.nowIso();

    if (existing) {
      existing.url = input.url;
      existing.currentSecret = input.secret;
      existing.enabled = input.enabled ?? true;
      if (input.compressPayloads !== undefined) existing.compressPayloads = input.compressPayloads;
      if (input.compressionMinBytes !== undefined) existing.compressionMinBytes = input.compressionMinBytes;
      existing.updatedAt = ts;
      this.store.saveConfig(existing);
      return existing;
    }

    const config: MerchantWebhookConfig = {
      id: `whcfg_${randomUUID()}`,
      merchantId: input.merchantId,
      url: input.url,
      enabled: input.enabled ?? true,
      currentSecret: input.secret,
      previousSecrets: [],
      compressPayloads: input.compressPayloads ?? false,
      compressionMinBytes: input.compressionMinBytes ?? DEFAULT_COMPRESSION_MIN_BYTES,
      createdAt: ts,
      updatedAt: ts,
    };
    this.store.saveConfig(config);
    return config;
  }

  rotateSecret(configId: string, nextSecret: string): MerchantWebhookConfig | undefined {
    const config = this.store.getConfig(configId);
    if (!config) return undefined;
    config.previousSecrets.unshift(config.currentSecret);
    config.previousSecrets = config.previousSecrets.slice(0, 5);
    config.currentSecret = nextSecret;
    config.updatedAt = this.clock.nowIso();
    this.store.saveConfig(config);
    return config;
  }

  listConfigs(): MerchantWebhookConfig[] {
    return this.store.listConfigs();
  }

  enqueueEvent(input: {
    merchantId: string;
    type: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  }): { accepted: boolean; delivery?: WebhookDeliveryLog; reason?: string } {
    const config = this.store.findConfigByMerchantId(input.merchantId);
    if (!config || !config.enabled) {
      return { accepted: false, reason: 'No enabled webhook config for merchant' };
    }

    const eventId = `whev_${randomUUID()}`;
    const event: PaymentWebhookEvent = {
      eventId,
      merchantId: input.merchantId,
      type: input.type,
      payload: input.payload,
      createdAt: this.clock.nowIso(),
    };
    const dedupeKey = input.idempotencyKey ?? `${config.id}:${eventId}:${input.type}`;
    const existingDeliveryId = this.store.getIdempotencyDeliveryId(dedupeKey);
    if (existingDeliveryId) {
      const existingDelivery = this.store.getDelivery(existingDeliveryId);
      return { accepted: false, reason: 'Duplicate idempotency key', delivery: existingDelivery };
    }

    const serializedEvent = JSON.stringify(event);
    const ts = this.clock.nowIso();
    const delivery: WebhookDeliveryLog = {
      id: `whdel_${randomUUID()}`,
      configId: config.id,
      merchantId: input.merchantId,
      eventId: event.eventId,
      idempotencyKey: dedupeKey,
      status: 'pending',
      attempt: 0,
      maxAttempts: MAX_ATTEMPTS,
      createdAt: ts,
      updatedAt: ts,
      nextAttemptAt: ts,
      payload: serializedEvent,
      responseBody: serializedEvent,
    };

    this.store.saveDelivery(delivery);
    this.store.setIdempotency(dedupeKey, delivery.id);
    return { accepted: true, delivery };
  }

  async deliverOne(delivery: WebhookDeliveryLog): Promise<void> {
    const config = this.store.getConfig(delivery.configId);
    if (!config || !config.enabled) {
      delivery.status = 'failed';
      delivery.lastError = 'Webhook config missing or disabled';
      delivery.updatedAt = this.clock.nowIso();
      this.store.saveDelivery(delivery);
      return;
    }

    const rawBody = delivery.payload ?? delivery.responseBody ?? '{}';
    const prepared = await prepareWebhookPayload(rawBody, config.currentSecret, {
      enabled: config.compressPayloads ?? false,
      minBytes: config.compressionMinBytes ?? DEFAULT_COMPRESSION_MIN_BYTES,
    });

    delivery.attempt += 1;
    delivery.status = 'processing';
    delivery.isCompressed = prepared.isCompressed;
    delivery.rawBytes = prepared.rawBytes;
    delivery.compressedBytes = prepared.compressedBytes;
    delivery.updatedAt = this.clock.nowIso();

    try {
      const headers: Record<string, string> = {
        ...prepared.headers,
        'X-Webhook-Idempotency-Key': delivery.idempotencyKey,
        'X-Webhook-Event-Id': delivery.eventId,
      };

      const response = await this.transport.send(config.url, {
        method: 'POST',
        headers,
        body: prepared.body,
        timeoutMs: ATTEMPT_TIMEOUT_MS,
      });

      webhookMetrics.recordDelivery(prepared.isCompressed, prepared.rawBytes, prepared.compressedBytes);
      this.logger.info('[Webhook] Delivery attempt completed', {
        deliveryId: delivery.id,
        attempt: delivery.attempt,
        isCompressed: prepared.isCompressed,
        rawBytes: prepared.rawBytes,
        compressedBytes: prepared.compressedBytes,
        compressionRatio: `${(prepared.compressionRatio * 100).toFixed(1)}%`,
      });

      const responseText = await response.text().catch(() => '');
      delivery.statusCode = response.status;
      delivery.responseBody = responseText;

      if (response.ok) {
        delivery.status = 'delivered';
        delivery.deliveredAt = this.clock.nowIso();
        delivery.nextAttemptAt = undefined;
      } else if (delivery.attempt >= delivery.maxAttempts) {
        delivery.status = 'dead_letter';
        delivery.lastError = `HTTP ${response.status}`;
        delivery.nextAttemptAt = undefined;
        this.store.addToDeadLetter(delivery);
      } else {
        delivery.status = 'retrying';
        delivery.lastError = `HTTP ${response.status}`;
        delivery.nextAttemptAt = new Date(this.clock.now() + this.computeBackoffDelay(delivery.attempt)).toISOString();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (delivery.attempt >= delivery.maxAttempts) {
        delivery.status = 'dead_letter';
        delivery.lastError = message;
        delivery.nextAttemptAt = undefined;
        this.store.addToDeadLetter(delivery);
      } else {
        delivery.status = 'retrying';
        delivery.lastError = message;
        delivery.nextAttemptAt = new Date(this.clock.now() + this.computeBackoffDelay(delivery.attempt)).toISOString();
      }
    } finally {
      delivery.updatedAt = this.clock.nowIso();
      this.store.saveDelivery(delivery);
    }
  }

  private deliveryShardKey(delivery: WebhookDeliveryLog): string {
    const config = this.store.getConfig(delivery.configId);
    return config ? shardKeyForUrl(config.url) : UNPARSEABLE_URL_SHARD;
  }

  getDispatcher(): ShardedDispatcher<WebhookDeliveryLog> {
    if (!this.dispatcher) {
      const opts = this.customDispatcherOptions ?? readShardDispatcherOptions();
      this.dispatcher = new ShardedDispatcher(opts, {
        shardKey: (d) => this.deliveryShardKey(d),
        dueAt: (delivery) => (delivery.nextAttemptAt ? Date.parse(delivery.nextAttemptAt) : undefined),
        deliver: (d) => this.deliverOne(d),
        logger: defaultLoggerInstance,
      });
    }
    return this.dispatcher;
  }

  dueDeliveries(now?: number): WebhookDeliveryLog[] {
    return this.store.findDueDeliveries(now ?? this.clock.now());
  }

  processDueDeliveries(): DispatchPassResult {
    return this.getDispatcher().dispatch(this.dueDeliveries());
  }

  async drainDeliveries(): Promise<void> {
    await this.processDueDeliveries().settled;
    await this.getDispatcher().idle();
  }

  getActiveShards(): string[] {
    return this.dispatcher?.activeShards() ?? [];
  }

  getDispatchStats(): DispatchStatsSnapshot & { config: ShardDispatcherOptions } {
    const opts = this.customDispatcherOptions ?? readShardDispatcherOptions();
    return { ...this.getDispatcher().stats(), config: opts };
  }

  startWorker(): void {
    if (this.workerRunning) return;
    this.getDispatcher();
    this.workerRunning = true;
    this.workerTimer = this.clock.setInterval(() => {
      this.processDueDeliveries();
    }, 1_000);
  }

  stopWorker(): void {
    if (this.workerTimer) {
      this.clock.clearInterval(this.workerTimer);
      this.workerTimer = undefined;
    }
    this.workerRunning = false;
  }

  listDeliveries(): WebhookDeliveryLog[] {
    return this.store.listDeliveries();
  }

  getDelivery(id: string): WebhookDeliveryLog | undefined {
    return this.store.getDelivery(id);
  }

  retryDeliveryManually(id: string): WebhookDeliveryLog | undefined {
    const item = this.store.getDelivery(id);
    if (!item) return undefined;
    if (item.status === 'delivered') return item;
    const ts = this.clock.nowIso();
    item.status = 'pending';
    item.attempt = 0;
    item.lastError = undefined;
    item.nextAttemptAt = ts;
    item.updatedAt = ts;
    this.store.saveDelivery(item);
    return item;
  }

  listDeadLetter(): WebhookDeliveryLog[] {
    return this.store.listDeadLetter();
  }
}

/* =====================================================
   Default Singleton Instance & Legacy Compatibility Exports
===================================================== */

export const defaultWebhookStore = new InMemoryWebhookStore();
export const defaultWebhookTransport = new FetchWebhookTransport();
export const defaultClock = new SystemClock();
export const defaultWebhookLogger = new SystemWebhookLogger();

export const defaultWebhookService = new WebhookRetryService({
  store: defaultWebhookStore,
  transport: defaultWebhookTransport,
  clock: defaultClock,
  logger: defaultWebhookLogger,
});

export function upsertWebhookConfig(input: {
  merchantId: string;
  url: string;
  secret: string;
  enabled?: boolean;
  compressPayloads?: boolean;
  compressionMinBytes?: number;
}): MerchantWebhookConfig {
  return defaultWebhookService.upsertConfig(input);
}

export function rotateWebhookSecret(configId: string, nextSecret: string): MerchantWebhookConfig | undefined {
  return defaultWebhookService.rotateSecret(configId, nextSecret);
}

export function listWebhookConfigs(): MerchantWebhookConfig[] {
  return defaultWebhookService.listConfigs();
}

export function enqueueWebhookEvent(input: {
  merchantId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}): { accepted: boolean; delivery?: WebhookDeliveryLog; reason?: string } {
  return defaultWebhookService.enqueueEvent(input);
}

export function startWebhookWorker(): void {
  defaultWebhookService.startWorker();
}

export function stopWebhookWorker(): void {
  defaultWebhookService.stopWorker();
}

export function listWebhookDeliveries(): WebhookDeliveryLog[] {
  return defaultWebhookService.listDeliveries();
}

export function getWebhookDelivery(id: string): WebhookDeliveryLog | undefined {
  return defaultWebhookService.getDelivery(id);
}

export function retryWebhookDeliveryManually(id: string): WebhookDeliveryLog | undefined {
  return defaultWebhookService.retryDeliveryManually(id);
}

export function listDeadLetterQueue(): WebhookDeliveryLog[] {
  return defaultWebhookService.listDeadLetter();
}

export async function drainWebhookDeliveries(): Promise<void> {
  return defaultWebhookService.drainDeliveries();
}

export function getActiveWebhookShards(): string[] {
  return defaultWebhookService.getActiveShards();
}

export function getWebhookDispatchStats(): DispatchStatsSnapshot & { config: ReturnType<typeof readShardDispatcherOptions> } {
  return defaultWebhookService.getDispatchStats();
}
