import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { messageQueue, QueueJob } from '../services/queue.js';
import {
  queueEmail,
  queueNotification,
  queueWebhook,
  processEmailJob,
  processNotificationJob,
  processWebhookJob,
  registerDefaultProcessors,
} from '../services/queue-producers.js';

describe('Message Queue', () => {
  beforeEach(() => {
    messageQueue.stop();
    // Clear all jobs
    const jobs = messageQueue.getAllJobs();
    jobs.forEach((job) => {
      messageQueue.deleteJob(job.id);
    });
  });

  afterEach(() => {
    messageQueue.stop();
  });

  describe('Job Enqueueing', () => {
    it('should enqueue an email job', async () => {
      const job = await queueEmail({
        to: 'user@example.com',
        subject: 'Test',
        body: 'Test body',
      });

      expect(job).toBeDefined();
      expect(job.queue).toBe('email');
      expect(job.status).toBe('pending');
      expect(job.attempts).toBe(0);
    });

    it('should enqueue a notification job', async () => {
      const job = await queueNotification({
        userId: 'user123',
        type: 'info',
        title: 'Test Notification',
        message: 'This is a test',
      });

      expect(job).toBeDefined();
      expect(job.queue).toBe('notifications');
      expect(job.status).toBe('pending');
    });

    it('should enqueue a webhook job', async () => {
      const job = await queueWebhook({
        url: 'https://example.com/webhook',
        method: 'POST',
        body: { test: true },
      });

      expect(job).toBeDefined();
      expect(job.queue).toBe('webhooks');
      expect(job.status).toBe('pending');
    });

    it('should retrieve a job by ID', async () => {
      const enqueuedJob = await queueEmail({
        to: 'user@example.com',
        subject: 'Test',
        body: 'Test body',
      });

      const retrievedJob = messageQueue.getJob(enqueuedJob.id);
      expect(retrievedJob).toBeDefined();
      expect(retrievedJob?.id).toBe(enqueuedJob.id);
    });

    it('should get all jobs', async () => {
      await queueEmail({
        to: 'user@example.com',
        subject: 'Test',
        body: 'Test body',
      });
      await queueNotification({
        userId: 'user123',
        type: 'info',
        title: 'Test',
        message: 'Test',
      });

      const allJobs = messageQueue.getAllJobs();
      expect(allJobs.length).toBe(2);
    });

    it('should get jobs by queue', async () => {
      await queueEmail({
        to: 'user@example.com',
        subject: 'Test',
        body: 'Test body',
      });
      await queueEmail({
        to: 'user2@example.com',
        subject: 'Test',
        body: 'Test body',
      });
      await queueNotification({
        userId: 'user123',
        type: 'info',
        title: 'Test',
        message: 'Test',
      });

      const emailJobs = messageQueue.getJobsByQueue('email');
      expect(emailJobs.length).toBe(2);

      const notificationJobs = messageQueue.getJobsByQueue('notifications');
      expect(notificationJobs.length).toBe(1);
    });
  });

  describe('Job Processing', () => {
    it('should process a pending email job', async () => {
      registerDefaultProcessors();

      const job = await queueEmail({
        to: 'user@example.com',
        subject: 'Test Email',
        body: 'Test body',
      });

      messageQueue.start();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const processedJob = messageQueue.getJob(job.id);
      expect(processedJob?.status).toBe('completed');
    });

    it('should process a notification job', async () => {
      registerDefaultProcessors();

      const job = await queueNotification({
        userId: 'user123',
        type: 'info',
        title: 'Test Notification',
        message: 'Test message',
      });

      messageQueue.start();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const processedJob = messageQueue.getJob(job.id);
      expect(processedJob?.status).toBe('completed');
    });

    it('should retry failed jobs', async () => {
      const failingProcessor = vi.fn().mockRejectedValue(new Error('Processing failed'));
      messageQueue.registerProcessor('test-queue', failingProcessor);

      const job = await messageQueue.enqueue('test-queue', { test: true }, 3);

      messageQueue.start();

      // Wait for processing and retry attempts
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const processedJob = messageQueue.getJob(job.id);
      expect(processedJob?.status).toBe('retrying');
      expect(processedJob?.attempts).toBeGreaterThan(0);
      expect(processedJob?.nextRetryAt).toBeDefined();
    });

    it('should fail after max attempts', async () => {
      const failingProcessor = vi.fn().mockRejectedValue(new Error('Processing failed'));
      messageQueue.registerProcessor('test-queue', failingProcessor);
      messageQueue.updateConfig({ maxAttempts: 2, retryDelayMs: 100 });

      const job = await messageQueue.enqueue('test-queue', { test: true }, 2);

      messageQueue.start();

      // Wait for all retries to complete
      await new Promise((resolve) => setTimeout(resolve, 4000));

      const processedJob = messageQueue.getJob(job.id);
      expect(processedJob?.status).toBe('failed');
      expect(processedJob?.attempts).toBe(2);
    });

    it('should handle jobs without registered processor', async () => {
      const job = await messageQueue.enqueue('unregistered-queue', { test: true });

      messageQueue.start();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const processedJob = messageQueue.getJob(job.id);
      expect(processedJob?.status).toBe('failed');
      expect(processedJob?.lastError).toContain('No processor found');
    });
  });

  describe('Job Processors', () => {
    it('should validate email job data', async () => {
      const invalidJob: QueueJob = {
        id: 'test',
        queue: 'email',
        data: { to: 'user@example.com' }, // Missing subject and body
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      await expect(processEmailJob(invalidJob)).rejects.toThrow('Missing required email fields');
    });

    it('should validate notification job data', async () => {
      const invalidJob: QueueJob = {
        id: 'test',
        queue: 'notifications',
        data: { userId: 'user123', type: 'info' }, // Missing title and message
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      await expect(processNotificationJob(invalidJob)).rejects.toThrow(
        'Missing required notification fields'
      );
    });

    it('should validate webhook job data', async () => {
      const invalidJob: QueueJob = {
        id: 'test',
        queue: 'webhooks',
        data: { method: 'POST' }, // Missing URL
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      await expect(processWebhookJob(invalidJob)).rejects.toThrow(
        'Missing required webhook field: url'
      );
    });
  });

  describe('Job Management', () => {
    it('should retry a failed job', async () => {
      const job = await messageQueue.enqueue('test-queue', { test: true });
      const updatedJob = messageQueue.getJob(job.id)!;
      updatedJob.status = 'failed';

      const retried = messageQueue.retryJob(job.id);
      expect(retried).toBe(true);

      const retriedJob = messageQueue.getJob(job.id)!;
      expect(retriedJob.status).toBe('pending');
      expect(retriedJob.attempts).toBe(0);
    });

    it('should not retry a completed job', async () => {
      const job = await messageQueue.enqueue('test-queue', { test: true });
      const updatedJob = messageQueue.getJob(job.id)!;
      updatedJob.status = 'completed';

      const retried = messageQueue.retryJob(job.id);
      expect(retried).toBe(false);
    });

    it('should delete a job', async () => {
      const job = await messageQueue.enqueue('test-queue', { test: true });
      const deleted = messageQueue.deleteJob(job.id);

      expect(deleted).toBe(true);
      expect(messageQueue.getJob(job.id)).toBeUndefined();
    });

    it('should clear jobs by status', async () => {
      const job1 = await messageQueue.enqueue('test-queue', { test: true });
      const job2 = await messageQueue.enqueue('test-queue', { test: true });

      messageQueue.getJob(job1.id)!.status = 'completed';
      messageQueue.getJob(job2.id)!.status = 'completed';

      const cleared = messageQueue.clearByStatus('completed');
      expect(cleared).toBe(2);
    });
  });

  describe('Queue Statistics', () => {
    it('should report queue statistics', async () => {
      await queueEmail({
        to: 'user@example.com',
        subject: 'Test',
        body: 'Test body',
      });
      await queueNotification({
        userId: 'user123',
        type: 'info',
        title: 'Test',
        message: 'Test',
      });

      const stats = messageQueue.getStats();

      expect(stats.total).toBe(2);
      expect(stats.pending).toBe(2);
      expect(stats.processing).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.retrying).toBe(0);
    });

    it('should update statistics as jobs are processed', async () => {
      registerDefaultProcessors();

      await queueEmail({
        to: 'user@example.com',
        subject: 'Test',
        body: 'Test body',
      });

      messageQueue.start();
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const stats = messageQueue.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(0);
    });
  });

describe('Configuration', () => {
    it('should get default configuration', () => {
      // Reset configuration to defaults
      messageQueue.updateConfig({
        maxAttempts: 3,
        retryDelayMs: 1000,
        retryBackoffMultiplier: 2,
        maxRetryDelayMs: 60 * 1000,
        pollIntervalMs: 1000,
        batchSize: 10,
      });

      const config = messageQueue.getConfig();

      expect(config.maxAttempts).toBe(3);
      expect(config.retryDelayMs).toBe(1000);
      expect(config.retryBackoffMultiplier).toBe(2);
    });

    it('should update configuration', () => {
      messageQueue.updateConfig({
        maxAttempts: 5,
        retryDelayMs: 2000,
      });

      const config = messageQueue.getConfig();
      expect(config.maxAttempts).toBe(5);
      expect(config.retryDelayMs).toBe(2000);
    });
  });

  describe('Queue Lifecycle', () => {
    it('should start and stop processing', () => {
      expect(() => messageQueue.start()).not.toThrow();
      expect(() => messageQueue.stop()).not.toThrow();
    });

    it('should warn if starting an already running queue', () => {
      const consoleSpy = vi.spyOn(console, 'warn');

      messageQueue.start();
      messageQueue.start(); // Try to start again

      expect(consoleSpy).toHaveBeenCalledWith('Queue processor already running');
      messageQueue.stop();

      consoleSpy.mockRestore();
    });
  });
});
