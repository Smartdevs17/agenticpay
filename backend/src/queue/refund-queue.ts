import { randomUUID } from 'node:crypto';
import { autoProcessApprovedRefunds, retryFailedRefund, getRefund, type RefundRecord } from '../services/refund-engine.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type QueueJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface QueueJob {
  id: string;
  type: 'auto_process' | 'retry_failed' | 'process_single';
  refundId?: string;
  workspaceId?: string;
  status: QueueJobStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  result?: { processed: number; failed: number; errors: string[] };
  createdAt: string;
  updatedAt: string;
  scheduledFor?: string;
}

export interface QueueStats {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

// ── In-Memory Queue Store ────────────────────────────────────────────────────

const jobStore = new Map<string, QueueJob>();
const POLL_INTERVAL_MS = 10_000;
const RETRY_DELAY_MS = 60_000;

class RefundQueue {
  private timer?: NodeJS.Timeout;
  private running = false;
  private providerFn?: (refund: RefundRecord) => Promise<{ success: boolean; txHash?: string; error?: string }>;

  setProvider(fn: (refund: RefundRecord) => Promise<{ success: boolean; txHash?: string; error?: string }>): void {
    this.providerFn = fn;
  }

  // ── Job Management ─────────────────────────────────────────────────────────

  enqueue(input: {
    type: QueueJob['type'];
    refundId?: string;
    workspaceId?: string;
    scheduledFor?: string;
  }): QueueJob {
    const job: QueueJob = {
      id: `rq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      refundId: input.refundId,
      workspaceId: input.workspaceId,
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scheduledFor: input.scheduledFor,
    };
    jobStore.set(job.id, job);
    return job;
  }

  enqueueAutoProcess(): QueueJob {
    return this.enqueue({ type: 'auto_process' });
  }

  enqueueRetryFailed(refundId: string): QueueJob {
    return this.enqueue({ type: 'retry_failed', refundId });
  }

  enqueueProcessSingle(refundId: string): QueueJob {
    return this.enqueue({ type: 'process_single', refundId });
  }

  getJob(jobId: string): QueueJob | undefined {
    return jobStore.get(jobId);
  }

  listJobs(filters?: { type?: QueueJob['type']; status?: QueueJobStatus }): QueueJob[] {
    let jobs = Array.from(jobStore.values());
    if (filters?.type) {
      jobs = jobs.filter((j) => j.type === filters.type);
    }
    if (filters?.status) {
      jobs = jobs.filter((j) => j.status === filters.status);
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  cancelJob(jobId: string): boolean {
    const job = jobStore.get(jobId);
    if (!job || job.status !== 'queued') return false;
    job.status = 'cancelled';
    job.updatedAt = new Date().toISOString();
    return true;
  }

  stats(): QueueStats {
    const all = Array.from(jobStore.values());
    const count = (s: QueueJobStatus) => all.filter((j) => j.status === s).length;
    return {
      total: all.length,
      queued: count('queued'),
      running: count('running'),
      completed: count('completed'),
      failed: count('failed'),
      cancelled: count('cancelled'),
    };
  }

  // ── Scheduler ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    const now = new Date().toISOString();
    const queued = Array.from(jobStore.values()).filter(
      (j) => j.status === 'queued' && (!j.scheduledFor || j.scheduledFor <= now),
    );

    for (const job of queued) {
      job.status = 'running';
      job.attempts++;
      job.updatedAt = new Date().toISOString();

      try {
        switch (job.type) {
          case 'auto_process': {
            const result = await autoProcessApprovedRefunds(this.providerFn);
            job.result = result;
            job.status = result.failed > 0 && job.attempts < job.maxAttempts ? 'queued' : 'completed';
            if (job.status === 'queued') {
              job.scheduledFor = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
            }
            break;
          }
          case 'retry_failed': {
            if (job.refundId) {
              await retryFailedRefund(job.refundId, this.providerFn);
            }
            job.status = 'completed';
            break;
          }
          case 'process_single': {
            if (job.refundId) {
              const refund = getRefund(job.refundId);
              if (refund && refund.status === 'approved') {
                const { processRefund } = await import('../services/refund-engine.js');
                await processRefund(job.refundId, this.providerFn);
              }
            }
            job.status = 'completed';
            break;
          }
        }
      } catch (error) {
        job.lastError = error instanceof Error ? error.message : String(error);
        if (job.attempts < job.maxAttempts) {
          job.status = 'queued';
          job.scheduledFor = new Date(Date.now() + RETRY_DELAY_MS * job.attempts).toISOString();
        } else {
          job.status = 'failed';
        }
      }

      job.updatedAt = new Date().toISOString();
    }
  }

  // ── Test Helpers ───────────────────────────────────────────────────────────

  resetForTests(): void {
    jobStore.clear();
  }
}

export const refundQueue = new RefundQueue();
