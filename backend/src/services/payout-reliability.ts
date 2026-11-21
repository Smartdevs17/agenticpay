// Issue #1155: Improve payout reliability (iteration 5)
// Implements payout queue management with dead letter queue and health monitoring
// Issue #1024: Integrated quota tracking to prevent provider quota exhaustion

import { EventEmitter } from 'events';
import { quotaService } from './quota.js';

/**
 * Payout request structure
 */
export interface PayoutRequest {
  id: string;
  recipientAddress: string;
  amount: string;
  currency: string;
  merchantId: string;
  providerId?: string;
  createdAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';
  metadata?: Record<string, unknown>;
}

/**
 * Payout result
 */
export interface PayoutResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
  retriable: boolean;
}

/**
 * Payout reliability configuration
 */
export interface PayoutReliabilityConfig {
  /** Maximum retry attempts before moving to dead letter queue */
  maxRetries: number;
  /** Initial retry delay in milliseconds */
  initialRetryDelayMs: number;
  /** Maximum retry delay in milliseconds */
  maxRetryDelayMs: number;
  /** Retry backoff multiplier */
  backoffMultiplier: number;
  /** Enable dead letter queue */
  enableDeadLetterQueue: boolean;
  /** Health check interval in milliseconds */
  healthCheckIntervalMs: number;
  /** Concurrent payout processing limit */
  concurrencyLimit: number;
  /** Respect provider quotas (Issue #1024) */
  respectQuota?: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_PAYOUT_CONFIG: PayoutReliabilityConfig = {
  maxRetries: 5,
  initialRetryDelayMs: 1000,
  maxRetryDelayMs: 300000,
  backoffMultiplier: 2,
  enableDeadLetterQueue: true,
  healthCheckIntervalMs: 60000,
  concurrencyLimit: 10,
  respectQuota: true,
};

/**
 * Payout health metrics
 */
export interface PayoutHealthMetrics {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  deadLetterCount: number;
  averageProcessingTimeMs: number;
  queueDepth: number;
  isHealthy: boolean;
  lastHealthCheckAt: string;
}

/**
 * Payout processor interface
 */
export interface IPayoutProcessor {
  process(request: PayoutRequest): Promise<PayoutResult>;
}

/**
 * Payout reliability service with queue management and monitoring
 */
export class PayoutReliabilityService extends EventEmitter {
  private queue: PayoutRequest[] = [];
  private deadLetterQueue: PayoutRequest[] = [];
  private processing: Set<string> = new Set();
  private metrics: PayoutHealthMetrics;
  private config: PayoutReliabilityConfig;
  private processor: IPayoutProcessor;
  private healthCheckInterval?: NodeJS.Timeout;
  private processingTimes: number[] = [];

  constructor(
    processor: IPayoutProcessor,
    config: Partial<PayoutReliabilityConfig> = {},
  ) {
    super();
    this.processor = processor;
    this.config = { ...DEFAULT_PAYOUT_CONFIG, ...config };
    this.metrics = this.initializeMetrics();
    this.startHealthMonitoring();
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): PayoutHealthMetrics {
    return {
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      deadLetterCount: 0,
      averageProcessingTimeMs: 0,
      queueDepth: 0,
      isHealthy: true,
      lastHealthCheckAt: new Date().toISOString(),
    };
  }

  /**
   * Enqueue a payout request
   */
  async enqueue(request: PayoutRequest): Promise<void> {
    this.queue.push(request);
    this.emit('payout:enqueued', request);
    
    // Process queue if under concurrency limit
    if (this.processing.size < this.config.concurrencyLimit) {
      this.processQueue();
    }
  }

  /**
   * Process the payout queue
   */
  private async processQueue(): Promise<void> {
    while (
      this.queue.length > 0 &&
      this.processing.size < this.config.concurrencyLimit
    ) {
      const request = this.queue.shift();
      if (!request) continue;

      this.processPayoutWithRetry(request);
    }
  }

  /**
   * Process a single payout with retry logic
   */
  private async processPayoutWithRetry(request: PayoutRequest): Promise<void> {
    this.processing.add(request.id);
    this.emit('payout:processing', request);

    const startTime = Date.now();

    try {
      // Check provider quota before attempting (Issue #1024)
      if (this.config.respectQuota && request.providerId) {
        if (!quotaService.canMakeRequest(request.providerId)) {
          await this.handleFailure(request, {
            success: false,
            error: `Provider quota exhausted for ${request.providerId}`,
            retriable: true,
          });
          return;
        }
      }

      const result = await this.processor.process(request);
      const processingTime = Date.now() - startTime;

      this.recordProcessingTime(processingTime);

      // Record quota usage (Issue #1024)
      if (this.config.respectQuota && request.providerId) {
        quotaService.recordRequest(request.providerId, request.attempts > 1);
      }

      if (result.success) {
        await this.handleSuccess(request, result);
      } else {
        await this.handleFailure(request, result);
      }
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.recordProcessingTime(processingTime);

      await this.handleFailure(request, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        retriable: true,
      });
    } finally {
      this.processing.delete(request.id);
      
      // Continue processing queue
      this.processQueue();
    }
  }

  /**
   * Handle successful payout
   */
  private async handleSuccess(
    request: PayoutRequest,
    result: PayoutResult,
  ): Promise<void> {
    request.status = 'completed';
    this.metrics.successCount++;
    this.metrics.totalProcessed++;

    this.emit('payout:completed', {
      request,
      transactionHash: result.transactionHash,
    });
  }

  /**
   * Handle failed payout
   */
  private async handleFailure(
    request: PayoutRequest,
    result: PayoutResult,
  ): Promise<void> {
    request.attempts++;
    request.lastAttemptAt = new Date().toISOString();
    request.lastError = result.error;

    // Check if should retry
    if (result.retriable && request.attempts < this.config.maxRetries) {
      // Schedule retry with exponential backoff
      const delay = this.calculateRetryDelay(request.attempts);
      
      this.emit('payout:retry_scheduled', {
        request,
        attempt: request.attempts,
        delayMs: delay,
      });

      setTimeout(() => {
        this.enqueue(request);
      }, delay);
    } else {
      // Move to dead letter queue or mark as failed
      if (this.config.enableDeadLetterQueue) {
        await this.moveToDeadLetterQueue(request);
      } else {
        request.status = 'failed';
        this.metrics.failureCount++;
        this.metrics.totalProcessed++;
        
        this.emit('payout:failed', request);
      }
    }
  }

  /**
   * Move payout to dead letter queue
   */
  private async moveToDeadLetterQueue(request: PayoutRequest): Promise<void> {
    request.status = 'dead_letter';
    this.deadLetterQueue.push(request);
    this.metrics.deadLetterCount++;
    this.metrics.totalProcessed++;

    this.emit('payout:dead_letter', request);

    // Alert if dead letter queue is growing
    if (this.deadLetterQueue.length > 100) {
      this.emit('alert:dead_letter_threshold', {
        count: this.deadLetterQueue.length,
        threshold: 100,
      });
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const delay = Math.min(
      this.config.initialRetryDelayMs * Math.pow(this.config.backoffMultiplier, attempt - 1),
      this.config.maxRetryDelayMs,
    );
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * delay;
    return delay + jitter;
  }

  /**
   * Record processing time for metrics
   */
  private recordProcessingTime(timeMs: number): void {
    this.processingTimes.push(timeMs);
    
    // Keep only last 100 measurements
    if (this.processingTimes.length > 100) {
      this.processingTimes.shift();
    }

    // Update average
    this.metrics.averageProcessingTimeMs =
      this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Perform health check
   */
  private performHealthCheck(): void {
    this.metrics.queueDepth = this.queue.length;
    this.metrics.lastHealthCheckAt = new Date().toISOString();

    // Health criteria
    const criteria = {
      queueDepthOk: this.queue.length < 1000,
      deadLetterOk: this.deadLetterQueue.length < 100,
      successRateOk:
        this.metrics.totalProcessed === 0 ||
        this.metrics.successCount / this.metrics.totalProcessed > 0.95,
      processingTimeOk: this.metrics.averageProcessingTimeMs < 5000,
    };

    this.metrics.isHealthy = Object.values(criteria).every((v) => v);

    this.emit('health:check', {
      metrics: this.metrics,
      criteria,
    });

    if (!this.metrics.isHealthy) {
      this.emit('alert:unhealthy', {
        metrics: this.metrics,
        criteria,
      });
    }
  }

  /**
   * Get current health metrics
   */
  getHealthMetrics(): PayoutHealthMetrics {
    return { ...this.metrics };
  }

  /**
   * Get dead letter queue
   */
  getDeadLetterQueue(): PayoutRequest[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Retry payout from dead letter queue
   */
  async retryDeadLetter(requestId: string): Promise<boolean> {
    const index = this.deadLetterQueue.findIndex((r) => r.id === requestId);
    if (index === -1) return false;

    const request = this.deadLetterQueue.splice(index, 1)[0];
    this.metrics.deadLetterCount--;

    // Reset attempts and enqueue
    request.attempts = 0;
    request.status = 'pending';
    await this.enqueue(request);

    this.emit('payout:retry_from_dead_letter', request);
    return true;
  }

  /**
   * Bulk retry dead letter queue
   */
  async retryAllDeadLetters(): Promise<number> {
    const count = this.deadLetterQueue.length;
    const requests = this.deadLetterQueue.splice(0);

    for (const request of requests) {
      request.attempts = 0;
      request.status = 'pending';
      await this.enqueue(request);
    }

    this.metrics.deadLetterCount = 0;
    this.emit('payout:bulk_retry_dead_letter', { count });

    return count;
  }

  /**
   * Clear dead letter queue
   */
  clearDeadLetterQueue(): number {
    const count = this.deadLetterQueue.length;
    this.deadLetterQueue = [];
    this.metrics.deadLetterCount = 0;
    
    this.emit('dead_letter:cleared', { count });
    return count;
  }

  /**
   * Stop the service
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.removeAllListeners();
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    pending: number;
    processing: number;
    deadLetter: number;
  } {
    return {
      pending: this.queue.length,
      processing: this.processing.size,
      deadLetter: this.deadLetterQueue.length,
    };
  }
}
