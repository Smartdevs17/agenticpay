/**
 * Message Queue Service
 * Manages async task processing with retry logic and state management
 */

export type QueueName = 'email' | 'notifications' | 'webhooks' | string;
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';

export interface QueueJob {
  id: string;
  queue: QueueName;
  data: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: Date;
  processedAt?: Date;
  nextRetryAt?: Date;
  completedAt?: Date;
}

export interface QueueConfig {
  maxAttempts: number;
  retryDelayMs: number;
  retryBackoffMultiplier: number;
  maxRetryDelayMs: number;
  pollIntervalMs: number;
  batchSize: number;
}

export interface JobProcessor {
  (job: QueueJob): Promise<void>;
}

const DEFAULT_CONFIG: QueueConfig = {
  maxAttempts: 3,
  retryDelayMs: 1000, // 1 second
  retryBackoffMultiplier: 2, // exponential backoff
  maxRetryDelayMs: 60 * 1000, // 1 minute max
  pollIntervalMs: 1000, // 1 second
  batchSize: 10,
};

/**
 * In-memory message queue implementation
 * Suitable for single-instance deployments; use Redis for distributed systems
 */
class MessageQueue {
  private jobs: Map<string, QueueJob> = new Map();
  private processors: Map<QueueName, JobProcessor> = new Map();
  private config: QueueConfig;
  private isRunning = false;
  private processingInterval?: NodeJS.Timeout;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a job processor for a queue
   */
  registerProcessor(queue: QueueName, processor: JobProcessor): void {
    this.processors.set(queue, processor);
  }

  /**
   * Queue a new job
   */
  async enqueue(
    queue: QueueName,
    data: unknown,
    maxAttempts?: number
  ): Promise<QueueJob> {
    const job: QueueJob = {
      id: this.generateJobId(),
      queue,
      data,
      status: 'pending',
      attempts: 0,
      maxAttempts: maxAttempts || this.config.maxAttempts,
      createdAt: new Date(),
    };

    this.jobs.set(job.id, job);
    console.log(`Job enqueued: ${JSON.stringify(job)}`);

    return job;
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): QueueJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs
   */
  getAllJobs(): QueueJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get jobs by queue
   */
  getJobsByQueue(queue: QueueName): QueueJob[] {
    return Array.from(this.jobs.values()).filter((job) => job.queue === queue);
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: JobStatus): QueueJob[] {
    return Array.from(this.jobs.values()).filter((job) => job.status === status);
  }

  /**
   * Start processing jobs
   */
  start(): void {
    if (this.isRunning) {
      console.warn('Queue processor already running');
      return;
    }

    this.isRunning = true;
    console.log('Message queue processor started');

    this.processingInterval = setInterval(() => {
      this.processJobs();
    }, this.config.pollIntervalMs);
  }

  /**
   * Stop processing jobs
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    console.log('Message queue processor stopped');
  }

  /**
   * Process pending and retryable jobs
   */
  private async processJobs(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      const now = new Date();
      const jobsToProcess = Array.from(this.jobs.values())
        .filter(
          (job) =>
            (job.status === 'pending' ||
              (job.status === 'retrying' && job.nextRetryAt && job.nextRetryAt <= now)) &&
            job.attempts < job.maxAttempts
        )
        .slice(0, this.config.batchSize);

      for (const job of jobsToProcess) {
        await this.processJob(job);
      }
    } catch (error) {
      console.error('Error in job processing loop:', error);
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: QueueJob): Promise<void> {
    const processor = this.processors.get(job.queue);

    if (!processor) {
      console.warn(`No processor registered for queue: ${job.queue}`);
      job.status = 'failed';
      job.lastError = `No processor found for queue: ${job.queue}`;
      return;
    }

    try {
      job.status = 'processing';
      job.attempts += 1;

      await processor(job);

      job.status = 'completed';
      job.completedAt = new Date();
      job.processedAt = new Date();
      console.log(`Job completed: ${job.id}`);
    } catch (error) {
      job.lastError = error instanceof Error ? error.message : String(error);
      job.processedAt = new Date();

      if (job.attempts < job.maxAttempts) {
        // Schedule retry
        const delayMs = Math.min(
          this.config.retryDelayMs * Math.pow(this.config.retryBackoffMultiplier, job.attempts - 1),
          this.config.maxRetryDelayMs
        );
        job.status = 'retrying';
        job.nextRetryAt = new Date(Date.now() + delayMs);
        console.log(`Job scheduled for retry: ${job.id} in ${delayMs}ms`);
      } else {
        // Max retries exceeded
        job.status = 'failed';
        console.error(`Job failed after ${job.attempts} attempts: ${job.id}`, job.lastError);
      }
    }
  }

  /**
   * Retry a failed job
   */
  retryJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);

    if (!job) {
      return false;
    }

    if (job.status !== 'failed') {
      return false;
    }

    job.status = 'pending';
    job.attempts = 0;
    job.nextRetryAt = undefined;

    return true;
  }

  /**
   * Delete a job
   */
  deleteJob(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  /**
   * Clear jobs by status
   */
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

  /**
   * Get queue statistics
   */
  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    retrying: number;
  } {
    const jobs = Array.from(this.jobs.values());

    return {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === 'pending').length,
      processing: jobs.filter((j) => j.status === 'processing').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      retrying: jobs.filter((j) => j.status === 'retrying').length,
    };
  }

  /**
   * Generate a unique job ID
   */
  private generateJobId(): string {
    return `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get configuration
   */
  getConfig(): QueueConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QueueConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Export singleton instance
export const messageQueue = new MessageQueue();
