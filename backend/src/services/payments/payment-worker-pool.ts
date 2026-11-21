/**
 * payment-worker-pool.ts — Issue #945
 *
 * Horizontally scalable payment worker pool backed by BullMQ + Redis.
 *
 * Multiple worker instances connect to the same Redis queue and compete for
 * payment jobs, giving automatic load distribution across processes/hosts.
 * Each instance runs `concurrency` parallel workers. Jobs are persisted in
 * Redis so they survive process restarts, and failed jobs are retried with
 * exponential back-off before being dead-lettered.
 *
 * When Redis is unavailable the pool falls back to an in-process queue so the
 * service remains operational in single-instance mode.
 */

import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { ok, err, type Result } from '../../lib/result.js';
import { providerRegistry, type PaymentProviderRegistry } from './provider-registry.js';
import type { PaymentInput, PaymentOutput } from './providers/types.js';

export interface PaymentWorkerJob {
  paymentId: string;
  input: PaymentInput;
  preferredProviderId?: string;
  retries?: number;
}

export interface PaymentWorkerResult {
  paymentId: string;
  providerId: string;
  output: PaymentOutput;
}

export interface PaymentWorkerPoolConfig {
  redisUrl?: string;
  concurrency?: number;
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  queueName?: string;
  prefix?: string;
}

const DEFAULT_CONFIG: Required<PaymentWorkerPoolConfig> = {
  redisUrl: undefined,
  concurrency: 4,
  maxAttempts: 5,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  queueName: 'agenticpay:payments',
  prefix: 'agenticpay',
};

export interface PoolMetrics {
  queued: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  concurrency: number;
  workerCount: number;
}

export class PaymentWorkerPool {
  private readonly config: Required<PaymentWorkerPoolConfig>;
  private readonly registry: PaymentProviderRegistry;
  private queue: Queue | null = null;
  private workers: Worker[] = [];
  private running = false;
  private localQueue: PaymentWorkerJob[] = [];
  private localProcessing = new Set<string>();
  private localMetrics = { queued: 0, active: 0, completed: 0, failed: 0 };

  constructor(config: PaymentWorkerPoolConfig = {}, registry: PaymentProviderRegistry = providerRegistry) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registry = registry;
  }

  /** Start the pool: connect to Redis (or fall back to in-process queue) and spawn workers. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const redisUrl = this.config.redisUrl ?? process.env.REDIS_URL;
    const redisEnabled = process.env.REDIS_ENABLED === 'true' && redisUrl;

    if (redisEnabled && redisUrl) {
      try {
        const connection = this.parseRedisUrl(redisUrl);
        this.queue = new Queue(this.config.queueName, {
          connection,
          prefix: this.config.prefix,
          defaultJobOptions: {
            attempts: this.config.maxAttempts,
            backoff: { type: 'exponential', delay: this.config.initialDelayMs, maxDelay: this.config.maxDelayMs },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 500 },
          },
        });

        for (let i = 0; i < this.config.concurrency; i++) {
          const worker = new Worker(
            this.config.queueName,
            async (job: Job) => this.processJob(job),
            { connection, concurrency: 1 },
          );
          worker.on('completed', () => {
            this.localMetrics.completed++;
            this.localMetrics.active = Math.max(0, this.localMetrics.active - 1);
          });
          worker.on('failed', () => {
            this.localMetrics.failed++;
            this.localMetrics.active = Math.max(0, this.localMetrics.active - 1);
          });
          this.workers.push(worker);
        }

        console.log(`[payment-worker-pool] Started ${this.config.concurrency} workers on queue "${this.config.queueName}"`);
      } catch (error) {
        console.error('[payment-worker-pool] Redis connection failed, falling back to in-process queue', error);
        this.queue = null;
      }
    }

    if (!this.queue) {
      // In-process fallback: process jobs locally on a short interval
      const timer = setInterval(() => void this.drainLocal(), 1_000);
      timer.unref();
      (this as unknown as { _localTimer: NodeJS.Timeout })._localTimer = timer;
      console.log('[payment-worker-pool] Running in-process (Redis not configured)');
    }
  }

  /** Enqueue a payment for asynchronous processing by a worker. */
  async enqueue(input: PaymentInput, preferredProviderId?: string): Promise<string> {
    const paymentId = `pay_${crypto.randomUUID().replace(/-/g, '')}`;
    const job: PaymentWorkerJob = { paymentId, input, preferredProviderId };

    if (this.queue) {
      await this.queue.add('process-payment', job, {
        jobId: `payment:${paymentId}`,
      });
      this.localMetrics.queued++;
    } else {
      this.localQueue.push(job);
      this.localMetrics.queued++;
    }

    return paymentId;
  }

  /** Process a single job (BullMQ worker handler or local drain). */
  private async processJob(job: Job): Promise<PaymentWorkerResult> {
    const { paymentId, input, preferredProviderId } = job.data as PaymentWorkerJob;

    const result = await this.processPayment(input, preferredProviderId);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    return {
      paymentId,
      providerId: result.value.providerId,
      output: result.value.output,
    };
  }

  /** Route a payment through the provider registry (same logic as payment-router). */
  async processPayment(input: PaymentInput, preferredProviderId?: string): Promise<Result<PaymentOutput>> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return err({ code: 'INVALID_PAYMENT_AMOUNT', message: 'Payment amount must be a finite number greater than zero', statusCode: 400 });
    }

    const primaryId = preferredProviderId && this.registry.get(preferredProviderId)
      ? preferredProviderId
      : this.selectProviderId(input);

    const candidateIds = [primaryId, ...this.registry.list().filter((id) => id !== primaryId)];

    for (const id of candidateIds) {
      const provider = this.registry.get(id);
      if (!provider) continue;

      const start = Date.now();
      const providerResult = await provider.processPayment(input);
      const latencyMs = Date.now() - start;

      if (providerResult.ok) {
        this.registry.recordSuccess(id, latencyMs);
        return ok({ ...providerResult.value, providerId: id });
      }

      this.registry.recordError(id);
    }

    return err({ code: 'PROVIDER_UNAVAILABLE', message: 'All payment providers failed', statusCode: 502 });
  }

  private selectProviderId(input: PaymentInput): string {
    const EVM_NETWORKS = new Set(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']);
    const FIAT_CURRENCIES = new Set(['USD', 'EUR', 'GBP']);
    if (input.network === 'stellar') return 'soroban';
    if (EVM_NETWORKS.has(input.network)) return 'evm';
    if (input.token ? FIAT_CURRENCIES.has(input.token) : FIAT_CURRENCIES.has(input.currency)) return 'fiat';
    return 'credit';
  }

  /** Drain the in-process fallback queue (one tick). */
  private async drainLocal(): Promise<void> {
    if (this.localProcessing.size >= this.config.concurrency || this.localQueue.length === 0) return;

    const batch = this.localQueue.splice(0, this.config.concurrency - this.localProcessing.size);
    await Promise.all(batch.map((job) => this.processLocalJob(job)));
  }

  private async processLocalJob(job: PaymentWorkerJob): Promise<void> {
    this.localProcessing.add(job.paymentId);
    this.localMetrics.active++;
    try {
      await this.processPayment(job.input, job.preferredProviderId);
      this.localMetrics.completed++;
    } catch {
      this.localMetrics.failed++;
    } finally {
      this.localProcessing.delete(job.paymentId);
      this.localMetrics.active = Math.max(0, this.localMetrics.active - 1);
    }
  }

  /** Get current pool metrics. */
  async getMetrics(): Promise<PoolMetrics> {
    if (this.queue) {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
      ]);
      return {
        queued: waiting,
        active,
        completed,
        failed,
        delayed,
        concurrency: this.config.concurrency,
        workerCount: this.workers.length,
      };
    }
    return {
      ...this.localMetrics,
      concurrency: this.config.concurrency,
      workerCount: 1,
    };
  }

  /** Pause the queue (no new jobs will be picked up). */
  async pause(): Promise<void> {
    await this.queue?.pause();
  }

  /** Resume the queue. */
  async resume(): Promise<void> {
    await this.queue?.resume();
  }

  /** Gracefully shut down all workers and close the queue connection. */
  async shutdown(): Promise<void> {
    this.running = false;
    await Promise.all(this.workers.map((w) => w.close()));
    this.workers = [];
    await this.queue?.close();
    this.queue = null;
    if (this.localQueue.length > 0) {
      this.localQueue = [];
    }
  }

  private parseRedisUrl(url: string): ConnectionOptions {
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname || 'localhost',
        port: parseInt(parsed.port || '6379', 10),
        password: parsed.password || undefined,
        username: parsed.username || undefined,
        tls: parsed.protocol === 'rediss:' ? {} : undefined,
      };
    } catch {
      const [host, port] = url.split(':');
      return { host: host || 'localhost', port: parseInt(port || '6379', 10) };
    }
  }
}

/** Singleton accessor so routes and services share one pool instance. */
let _pool: PaymentWorkerPool | null = null;

export function getPaymentWorkerPool(config?: PaymentWorkerPoolConfig): PaymentWorkerPool {
  if (!_pool) _pool = new PaymentWorkerPool(config);
  return _pool;
}

export function resetPaymentWorkerPoolForTesting(): void {
  _pool = null;
}
