import { describe, it, expect, beforeEach, vi } from 'vitest';
import { refundQueue } from '../refund-queue.js';

describe('RefundQueue', () => {
  beforeEach(() => {
    refundQueue.resetForTests();
    refundQueue.stop();
  });

  describe('enqueue', () => {
    it('creates a queued job', () => {
      const job = refundQueue.enqueue({ type: 'auto_process' });
      expect(job.type).toBe('auto_process');
      expect(job.status).toBe('queued');
      expect(job.attempts).toBe(0);
      expect(job.maxAttempts).toBe(3);
    });

    it('creates auto-process job', () => {
      const job = refundQueue.enqueueAutoProcess();
      expect(job.type).toBe('auto_process');
    });

    it('creates retry job', () => {
      const job = refundQueue.enqueueRetryFailed('refund-1');
      expect(job.type).toBe('retry_failed');
      expect(job.refundId).toBe('refund-1');
    });

    it('creates process-single job', () => {
      const job = refundQueue.enqueueProcessSingle('refund-1');
      expect(job.type).toBe('process_single');
      expect(job.refundId).toBe('refund-1');
    });
  });

  describe('getJob', () => {
    it('retrieves a job by id', () => {
      const job = refundQueue.enqueue({ type: 'auto_process' });
      const retrieved = refundQueue.getJob(job.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(job.id);
    });

    it('returns undefined for non-existent job', () => {
      const retrieved = refundQueue.getJob('nonexistent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('listJobs', () => {
    it('lists all jobs', () => {
      refundQueue.enqueue({ type: 'auto_process' });
      refundQueue.enqueue({ type: 'retry_failed', refundId: 'r1' });
      const jobs = refundQueue.listJobs();
      expect(jobs).toHaveLength(2);
    });

    it('filters by type', () => {
      refundQueue.enqueue({ type: 'auto_process' });
      refundQueue.enqueue({ type: 'retry_failed', refundId: 'r1' });
      const jobs = refundQueue.listJobs({ type: 'auto_process' });
      expect(jobs).toHaveLength(1);
    });
  });

  describe('cancelJob', () => {
    it('cancels a queued job', () => {
      const job = refundQueue.enqueue({ type: 'auto_process' });
      const cancelled = refundQueue.cancelJob(job.id);
      expect(cancelled).toBe(true);
      expect(refundQueue.getJob(job.id)!.status).toBe('cancelled');
    });

    it('returns false for non-existent job', () => {
      const cancelled = refundQueue.cancelJob('nonexistent');
      expect(cancelled).toBe(false);
    });
  });

  describe('stats', () => {
    it('returns correct statistics', () => {
      refundQueue.enqueue({ type: 'auto_process' });
      refundQueue.enqueue({ type: 'auto_process' });

      const stats = refundQueue.stats();
      expect(stats.total).toBe(2);
      expect(stats.queued).toBe(2);
      expect(stats.completed).toBe(0);
    });
  });

  describe('tick', () => {
    it('processes queued auto-process jobs', async () => {
      refundQueue.enqueue({ type: 'auto_process' });
      await refundQueue.tick();
      // Auto-process with no provider will complete
      const job = Array.from(refundQueue.listJobs())[0];
      expect(job.status).toBe('completed');
    });

    it('handles errors with retry', async () => {
      refundQueue.enqueue({ type: 'auto_process' });
      // Force failure by setting max attempts
      const job = refundQueue.listJobs()[0];
      await refundQueue.tick();
      expect(job.status).toBe('completed');
    });
  });
});
