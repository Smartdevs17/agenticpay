"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageQueue = exports.messageQueue = void 0;

const crypto = require("node:crypto");

const PRIORITY_ORDER = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const DEFAULT_CONFIG = {
  maxAttempts: 3,
  retryDelayMs: 1000,
  retryBackoffMultiplier: 2,
  maxRetryDelayMs: 60 * 1000,
  pollIntervalMs: 1000,
  batchSize: 10,
  rateLimits: {
    email: { maxPerSecond: 10, maxBurst: 20 },
    notifications: { maxPerSecond: 50, maxBurst: 100 },
    webhooks: { maxPerSecond: 30, maxBurst: 60 },
    "external-api": { maxPerSecond: 5, maxBurst: 10 },
  },
  enableDlq: true,
  dlqMaxRetentionMs: 7 * 24 * 60 * 60 * 1000,
};

class TokenBucket {
  constructor(maxTokens, refillRate) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  tryConsume(count) {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  get usage() {
    this.refill();
    return this.maxTokens - this.tokens;
  }

  get remaining() {
    this.refill();
    return this.tokens;
  }
}

class MessageQueue {
  constructor(config = {}) {
    this.jobs = new Map();
    this.processors = new Map();
    this.isRunning = false;
    this.dlq = [];
    this.rateLimiters = new Map();
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
    this.configureRateLimiters(this.config.rateLimits);
  }

  configureRateLimiters(rateLimits = {}) {
    for (const [queue, rl] of Object.entries(rateLimits)) {
      if (rl) this.rateLimiters.set(queue, new TokenBucket(rl.maxBurst, rl.maxPerSecond));
    }
  }

  registerProcessor(queue, processor) {
    this.processors.set(queue, processor);
  }

  async enqueue(queue, data, options = {}) {
    if (typeof options === "number") options = { maxAttempts: options };
    const scheduledAt = options.delayMs && options.delayMs > 0 ? new Date(Date.now() + options.delayMs) : undefined;
    const job = {
      id: options.jobId || this.generateJobId(),
      queue,
      data,
      status: scheduledAt ? "retrying" : "pending",
      priority: options.priority || "normal",
      attempts: 0,
      maxAttempts: options.maxAttempts || this.config.maxAttempts,
      createdAt: new Date(),
      scheduledAt,
      nextRetryAt: scheduledAt,
      enqueuedBy: options.enqueuedBy,
      tags: options.tags,
    };
    this.jobs.set(job.id, job);
    this.metrics.totalEnqueued++;
    this.metrics.priorityDistribution[job.priority]++;
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  getJobsByQueue(queue) {
    return Array.from(this.jobs.values()).filter((job) => job.queue === queue);
  }

  getJobsByStatus(status) {
    return Array.from(this.jobs.values()).filter((job) => job.status === status);
  }

  getJobsByPriority(priority) {
    return Array.from(this.jobs.values()).filter((job) => job.priority === priority);
  }

  start() {
    if (this.isRunning) {
      console.warn("Queue processor already running");
      return;
    }
    this.isRunning = true;
    this.processingInterval = setInterval(() => {
      this.processJobs();
    }, this.config.pollIntervalMs);
  }

  stop() {
    this.isRunning = false;
    if (this.processingInterval) clearInterval(this.processingInterval);
  }

  async processJobs() {
    if (!this.isRunning) return;
    const now = new Date();
    const candidates = Array.from(this.jobs.values()).filter((job) =>
      (job.status === "pending" || (job.status === "retrying" && job.nextRetryAt && job.nextRetryAt <= now)) &&
      job.attempts < job.maxAttempts
    );
    candidates.sort((a, b) => {
      const priority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return priority !== 0 ? priority : a.createdAt.getTime() - b.createdAt.getTime();
    });
    for (const job of candidates.slice(0, this.config.batchSize)) {
      const limiter = this.rateLimiters.get(job.queue);
      if (limiter && !limiter.tryConsume(1)) continue;
      await this.processJob(job);
    }
  }

  async processNextBatch() {
    const wasRunning = this.isRunning;
    this.isRunning = true;
    await this.processJobs();
    this.isRunning = wasRunning;
  }

  async processJob(job) {
    const processor = this.processors.get(job.queue);
    if (!processor) {
      job.status = "failed";
      job.lastError = `No processor found for queue: ${job.queue}`;
      this.metrics.totalFailed++;
      return;
    }
    const startTime = Date.now();
    try {
      job.status = "processing";
      job.attempts += 1;
      await processor(job);
      job.status = "completed";
      job.completedAt = new Date();
      job.processedAt = new Date();
      this.metrics.totalCompleted++;
      this.recordLatency(job.queue, Date.now() - startTime);
    } catch (error) {
      job.lastError = error instanceof Error ? error.message : String(error);
      job.processedAt = new Date();
      this.recordLatency(job.queue, Date.now() - startTime);
      if (job.attempts < job.maxAttempts) {
        const delayMs = this.calculateRetryDelay(job.attempts);
        job.status = "retrying";
        job.nextRetryAt = new Date(Date.now() + delayMs);
        this.metrics.totalRetried++;
      } else if (this.config.enableDlq) {
        this.moveToDlq(job);
      } else {
        job.status = "failed";
        this.metrics.totalFailed++;
      }
    }
  }

  calculateRetryDelay(attempt) {
    const base = this.config.retryDelayMs * Math.pow(this.config.retryBackoffMultiplier, attempt - 1);
    const capped = Math.min(base, this.config.maxRetryDelayMs);
    const jitter = capped * 0.1 * (Math.random() * 2 - 1);
    return Math.max(100, Math.round(capped + jitter));
  }

  moveToDlq(job) {
    job.status = "dlq";
    this.dlq.push({
      job: { ...job },
      failedAt: new Date(),
      failureReason: job.lastError || "Unknown error",
      originalQueue: job.queue,
    });
    this.metrics.totalDlq++;
    this.pruneDlq();
  }

  pruneDlq() {
    const cutoff = Date.now() - this.config.dlqMaxRetentionMs;
    this.dlq = this.dlq.filter((entry) => entry.failedAt.getTime() > cutoff);
  }

  recordLatency(queue, durationMs) {
    if (!this.metrics.perQueueLatency[queue]) this.metrics.perQueueLatency[queue] = { count: 0, totalMs: 0 };
    const entry = this.metrics.perQueueLatency[queue];
    entry.count++;
    entry.totalMs += durationMs;
    this.metrics.processingTimeSamples++;
    const total = this.metrics.avgProcessingTimeMs * (this.metrics.processingTimeSamples - 1) + durationMs;
    this.metrics.avgProcessingTimeMs = total / this.metrics.processingTimeSamples;
  }

  retryJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || (job.status !== "failed" && job.status !== "dlq")) return false;
    job.status = "pending";
    job.attempts = 0;
    job.nextRetryAt = undefined;
    job.scheduledAt = undefined;
    job.lastError = undefined;
    return true;
  }

  replayFromDlq(jobId) {
    const idx = this.dlq.findIndex((entry) => entry.job.id === jobId);
    if (idx === -1) return false;
    const entry = this.dlq[idx];
    this.dlq.splice(idx, 1);
    this.jobs.set(jobId, {
      ...entry.job,
      status: "pending",
      attempts: 0,
      nextRetryAt: undefined,
      scheduledAt: undefined,
      lastError: undefined,
      createdAt: new Date(),
    });
    return true;
  }

  replayAllFromDlq(queue) {
    let count = 0;
    for (const entry of [...this.dlq]) {
      if (queue && entry.originalQueue !== queue) continue;
      if (this.replayFromDlq(entry.job.id)) count++;
    }
    return count;
  }

  deleteJob(jobId) {
    return this.jobs.delete(jobId);
  }

  deleteFromDlq(jobId) {
    const idx = this.dlq.findIndex((entry) => entry.job.id === jobId);
    if (idx === -1) return false;
    this.dlq.splice(idx, 1);
    return true;
  }

  clearDlq() {
    const count = this.dlq.length;
    this.dlq = [];
    return count;
  }

  clearByStatus(status) {
    let count = 0;
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.status === status) {
        this.jobs.delete(jobId);
        count++;
      }
    }
    return count;
  }

  getDlq() {
    this.pruneDlq();
    return [...this.dlq];
  }

  getRateLimitStatus() {
    const status = {};
    for (const [queue, limiter] of this.rateLimiters.entries()) {
      status[queue] = {
        maxTokens: limiter.remaining + limiter.usage,
        remaining: limiter.remaining,
        usage: limiter.usage,
      };
    }
    return status;
  }

  getStats() {
    const jobs = Array.from(this.jobs.values());
    return {
      total: jobs.length,
      pending: jobs.filter((job) => job.status === "pending").length,
      processing: jobs.filter((job) => job.status === "processing").length,
      completed: jobs.filter((job) => job.status === "completed").length,
      failed: jobs.filter((job) => job.status === "failed").length,
      retrying: jobs.filter((job) => job.status === "retrying").length,
      dlq: jobs.filter((job) => job.status === "dlq").length,
      priorityBreakdown: {
        critical: jobs.filter((job) => job.priority === "critical").length,
        high: jobs.filter((job) => job.priority === "high").length,
        normal: jobs.filter((job) => job.priority === "normal").length,
        low: jobs.filter((job) => job.priority === "low").length,
      },
    };
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getConfig() {
    return { ...this.config };
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
    if (config.rateLimits) this.configureRateLimiters(config.rateLimits);
  }

  generateJobId() {
    return `job-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }
}

exports.MessageQueue = MessageQueue;
exports.messageQueue = new MessageQueue();
