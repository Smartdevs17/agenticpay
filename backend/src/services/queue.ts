import crypto from 'node:crypto';

export type QueueName = 'email' | 'notifications' | 'webhooks' | 'payments' | 'external-api' | string;

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying' | 'dlq';

export type JobPriority = 'critical' | 'high' | 'normal' | 'low';

const PRIORITY_ORDER: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export interface QueueJob {
  id: string;
  queue: QueueName;
  data: unknown;
  status: JobStatus;
  priority: JobPriority;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: Date;
  processedAt?: Date;
  nextRetryAt?: Date;
  scheduledAt?: Date;
  completedAt?: Date;
  enqueuedBy?: string;
  tags?: string[];
}

export interface DlqEntry {
  job: QueueJob;
  failedAt: Date;
  failureReason: string;
  originalQueue: QueueName;
}

export interface RateLimitConfig {
  maxPerSecond: number;
  maxBurst: number;
}

export interface QueueConfig {
  maxAttempts: number;
  retryDelayMs: number;
  retryBackoffMultiplier: number;
  maxRetryDelayMs: number;
  pollIntervalMs: number;
  batchSize: number;
  rateLimits: Partial<Record<QueueName, RateLimitConfig>>;
  enableDlq: boolean;
  dlqMaxRetentionMs: number;
}

export interface JobProcessor {
  (job: QueueJob): Promise<void>;
}

const DEFAULT_CONFIG: QueueConfig = {
  maxAttempts: 3,
  retryDelayMs: 1000,
  retryBackoffMultiplier: 2,
  maxRetryDelayMs: 60 * 1000,
  pollIntervalMs: 1000,
  batchSize: 10,
  rateLimits: {
    'email': { maxPerSecond: 10, maxBurst: 20 },
    'notifications': { maxPerSecond: 50, maxBurst: 100 },
    'webhooks': { maxPerSecond: 30, maxBurst: 60 },
    'external-api': { maxPerSecond: 5, maxBurst: 10 },
  },
  enableDlq: true,
  dlqMaxRetentionMs: 7 * 24 * 60 * 60 * 1000,
};

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(private maxTokens: number, private refillRate: number) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  tryConsume(count: number): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  get usage(): number {
    this.refill();
    return this.maxTokens - this.tokens;
  }

  get remaining(): number {
    this.refill();
    return this.tokens;
  }
}

class MessageQueue {
  private jobs: Map<string, QueueJob> = new Map();
  private processors: Map<QueueName, JobProcessor> = new Map();
  private config: QueueConfig;
  private isRunning = false;
  private processingInterval?: NodeJS.Timeout;
  private dlq: DlqEntry[] = [];
  private rateLimiters: Map<QueueName, TokenBucket> = new Map();
  private metrics: {
    totalEnqueued: number;
    totalCompleted: number;
    totalFailed: number;
    totalDlq: number;
    totalRetried: number;
    avgProcessingTimeMs: number;
    processingTimeSamples: number;
    priorityDistribution: Record<JobPriority, number>;
    perQueueLatency: Record<string, { count: number; totalMs: number }>;
  };

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = {
      totalEnqueued: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalDlq: 0,
      totalRetried: 0,
      avgProcessingTimeMs: 0,
      processingTimeSamples: 0,
      priorityDistribution: { critical: 0, high: 0, normal: 0, low: 0 },
      perQueueLatency: {},
    };

    for (const [queue, rl] of Object.entries(this.config.rateLimits)) {
      if (rl) {
        this.rateLimiters.set(queue, new TokenBucket(rl.maxBurst, rl.maxPerSecond));
      }
    }
  }

  registerProcessor(queue: QueueName, processor: JobProcessor): void {
    this.processors.set(queue, processor);
  }

  async enqueue(
    queue: QueueName,
    data: unknown,
    options?: {
      maxAttempts?: number;
      priority?: JobPriority;
      enqueuedBy?: string;
      tags?: string[];
      delayMs?: number;
      jobId?: string;
    }
  ): Promise<QueueJob> {
    const scheduledAt = options?.delayMs && options.delayMs > 0
      ? new Date(Date.now() + options.delayMs)
      : undefined;

    const job: QueueJob = {
      id: options?.jobId ?? this.generateJobId(),
      queue,
      data,
      status: scheduledAt ? 'retrying' : 'pending',
      priority: options?.priority ?? 'normal',
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? this.config.maxAttempts,
      createdAt: new Date(),
      scheduledAt,
      nextRetryAt: scheduledAt,
      enqueuedBy: options?.enqueuedBy,
      tags: options?.tags,
    };

    this.jobs.set(job.id, job);
    this.metrics.totalEnqueued++;
    this.metrics.priorityDistribution[job.priority]++;

    return job;
  }

  getJob(jobId: string): QueueJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): QueueJob[] {
    return Array.from(this.jobs.values());
  }

  getJobsByQueue(queue: QueueName): QueueJob[] {
    return Array.from(this.jobs.values()).filter((job) => job.queue === queue);
  }

  getJobsByStatus(status: JobStatus): QueueJob[] {
    return Array.from(this.jobs.values()).filter((job) => job.status === status);
  }

  getJobsByPriority(priority: JobPriority): QueueJob[] {
    return Array.from(this.jobs.values()).filter((job) => job.priority === priority);
  }

  start(): void {
    if (this.isRunning) {
      console.warn('Queue processor already running');
      return;
    }
    this.isRunning = true;
    this.processingInterval = setInterval(() => {
      this.processJobs();
    }, this.config.pollIntervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
  }

  private async processJobs(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const now = new Date();
      const candidates = Array.from(this.jobs.values()).filter(
        (job) =>
          (job.status === 'pending' ||
            (job.status === 'retrying' && job.nextRetryAt && job.nextRetryAt <= now)) &&
          job.attempts < job.maxAttempts
      );

      candidates.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority];
        const pb = PRIORITY_ORDER[b.priority];
        if (pa !== pb) return pa - pb;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      const batch = candidates.slice(0, this.config.batchSize);

      for (const job of batch) {
        const limiter = this.rateLimiters.get(job.queue);
        if (limiter && !limiter.tryConsume(1)) {
          continue;
        }
        await this.processJob(job);
      }
    } catch (error) {
      console.error('Error in job processing loop:', error);
    }
  }

  async processNextBatch(): Promise<void> {
    const wasRunning = this.isRunning;
    this.isRunning = true;
    await this.processJobs();
    this.isRunning = wasRunning;
  }

  private async processJob(job: QueueJob): Promise<void> {
    const processor = this.processors.get(job.queue);

    if (!processor) {
      job.status = 'failed';
      job.lastError = `No processor found for queue: ${job.queue}`;
      this.metrics.totalFailed++;
      return;
    }

    const startTime = Date.now();

    try {
      job.status = 'processing';
      job.attempts += 1;

      await processor(job);

      job.status = 'completed';
      job.completedAt = new Date();
      job.processedAt = new Date();
      this.metrics.totalCompleted++;

      const durationMs = Date.now() - startTime;
      this.recordLatency(job.queue, durationMs);
    } catch (error) {
      job.lastError = error instanceof Error ? error.message : String(error);
      job.processedAt = new Date();
      const durationMs = Date.now() - startTime;
      this.recordLatency(job.queue, durationMs);

      if (job.attempts < job.maxAttempts) {
        const delayMs = this.calculateRetryDelay(job.attempts);
        job.status = 'retrying';
        job.nextRetryAt = new Date(Date.now() + delayMs);
        this.metrics.totalRetried++;
      } else {
        if (this.config.enableDlq) {
          this.moveToDlq(job);
        } else {
          job.status = 'failed';
          this.metrics.totalFailed++;
        }
      }
    }
  }

  private calculateRetryDelay(attempt: number): number {
    const base = this.config.retryDelayMs * Math.pow(this.config.retryBackoffMultiplier, attempt - 1);
    const capped = Math.min(base, this.config.maxRetryDelayMs);
    const jitter = capped * 0.1 * (Math.random() * 2 - 1);
    return Math.max(100, Math.round(capped + jitter));
  }

  private moveToDlq(job: QueueJob): void {
    job.status = 'dlq';
    this.dlq.push({
      job: { ...job },
      failedAt: new Date(),
      failureReason: job.lastError ?? 'Unknown error',
      originalQueue: job.queue,
    });
    this.metrics.totalDlq++;
    this.pruneDlq();
  }

  private pruneDlq(): void {
    const cutoff = Date.now() - this.config.dlqMaxRetentionMs;
    this.dlq = this.dlq.filter((e) => e.failedAt.getTime() > cutoff);
  }

  private recordLatency(queue: string, durationMs: number): void {
    if (!this.metrics.perQueueLatency[queue]) {
      this.metrics.perQueueLatency[queue] = { count: 0, totalMs: 0 };
    }
    const entry = this.metrics.perQueueLatency[queue];
    entry.count++;
    entry.totalMs += durationMs;

    this.metrics.processingTimeSamples++;
    const total = this.metrics.avgProcessingTimeMs * (this.metrics.processingTimeSamples - 1) + durationMs;
    this.metrics.avgProcessingTimeMs = total / this.metrics.processingTimeSamples;
  }

  retryJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status !== 'failed' && job.status !== 'dlq') return false;

    job.status = 'pending';
    job.attempts = 0;
    job.nextRetryAt = undefined;
    job.scheduledAt = undefined;
    job.lastError = undefined;
    return true;
  }

  replayFromDlq(jobId: string): boolean {
    const idx = this.dlq.findIndex((e) => e.job.id === jobId);
    if (idx === -1) return false;

    const entry = this.dlq[idx];
    this.dlq.splice(idx, 1);

    const job: QueueJob = {
      ...entry.job,
      status: 'pending',
      attempts: 0,
      nextRetryAt: undefined,
      scheduledAt: undefined,
      lastError: undefined,
      createdAt: new Date(),
    };
    this.jobs.set(job.id, job);
    return true;
  }

  replayAllFromDlq(queue?: QueueName): number {
    let count = 0;
    for (const entry of [...this.dlq]) {
      if (queue && entry.originalQueue !== queue) continue;
      if (this.replayFromDlq(entry.job.id)) count++;
    }
    return count;
  }

  deleteJob(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  deleteFromDlq(jobId: string): boolean {
    const idx = this.dlq.findIndex((e) => e.job.id === jobId);
    if (idx === -1) return false;
    this.dlq.splice(idx, 1);
    return true;
  }

  clearDlq(): number {
    const count = this.dlq.length;
    this.dlq = [];
    return count;
  }

  clearByStatus(status: JobStatus): number {
    let count = 0;
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.status === status) {
        this.jobs.delete(jobId);
        count++;
      }
    }
    return count;
  }

  getDlq(): DlqEntry[] {
    this.pruneDlq();
    return [...this.dlq];
  }

  getRateLimitStatus(): Record<string, { maxTokens: number; remaining: number; usage: number }> {
    const status: Record<string, { maxTokens: number; remaining: number; usage: number }> = {};
    for (const [queue, limiter] of this.rateLimiters.entries()) {
      status[queue] = {
        maxTokens: limiter.remaining + limiter.usage,
        remaining: limiter.remaining,
        usage: limiter.usage,
      };
    }
    return status;
  }

  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    retrying: number;
    dlq: number;
    priorityBreakdown: Record<JobPriority, number>;
  } {
    const jobs = Array.from(this.jobs.values());
    return {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === 'pending').length,
      processing: jobs.filter((j) => j.status === 'processing').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      retrying: jobs.filter((j) => j.status === 'retrying').length,
      dlq: jobs.filter((j) => j.status === 'dlq').length,
      priorityBreakdown: {
        critical: jobs.filter((j) => j.priority === 'critical').length,
        high: jobs.filter((j) => j.priority === 'high').length,
        normal: jobs.filter((j) => j.priority === 'normal').length,
        low: jobs.filter((j) => j.priority === 'low').length,
      },
    };
  }

  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  getConfig(): QueueConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<QueueConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.rateLimits) {
      for (const [queue, rl] of Object.entries(config.rateLimits)) {
        if (rl) {
          this.rateLimiters.set(queue, new TokenBucket(rl.maxBurst, rl.maxPerSecond));
        }
      }
    }
  }

  private generateJobId(): string {
    return `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }
}

export const messageQueue = new MessageQueue();
export { MessageQueue };
