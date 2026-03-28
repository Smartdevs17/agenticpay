/**
 * Queue Routes
 * API endpoints for managing message queue and monitoring jobs
 */

import { Router } from 'express';
import { messageQueue, JobStatus } from '../services/queue.js';
import {
  queueEmail,
  queueNotification,
  queueWebhook,
  EmailJobData,
  NotificationJobData,
  WebhookJobData,
} from '../services/queue-producers.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

export const queueRouter = Router();

const allowedStatuses: JobStatus[] = ['pending', 'processing', 'completed', 'failed', 'retrying'];

function getParamAsString(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}

/**
 * POST /api/v1/queue/email
 * Queue an email to be sent asynchronously
 */
queueRouter.post(
  '/email',
  asyncHandler(async (req, res) => {
    const { to, subject, body, html, from } = req.body as EmailJobData;

    if (!to || !subject || !body) {
      throw new AppError(400, 'Missing required fields: to, subject, body', 'INVALID_REQUEST');
    }

    const job = await queueEmail({ to, subject, body, html, from });

    res.status(202).json({
      message: 'Email queued for delivery',
      jobId: job.id,
      status: job.status,
      queue: job.queue,
    });
  })
);

/**
 * POST /api/v1/queue/notification
 * Queue a notification to be delivered asynchronously
 */
queueRouter.post(
  '/notification',
  asyncHandler(async (req, res) => {
    const { userId, type, title, message, metadata } = req.body as NotificationJobData;

    if (!userId || !type || !title || !message) {
      throw new AppError(
        400,
        'Missing required fields: userId, type, title, message',
        'INVALID_REQUEST'
      );
    }

    const job = await queueNotification({ userId, type, title, message, metadata });

    res.status(202).json({
      message: 'Notification queued for delivery',
      jobId: job.id,
      status: job.status,
      queue: job.queue,
    });
  })
);

/**
 * POST /api/v1/queue/webhook
 * Queue a webhook call to be delivered asynchronously
 */
queueRouter.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const { url, method = 'POST', headers, body, timeout } = req.body as WebhookJobData;

    if (!url) {
      throw new AppError(400, 'Missing required field: url', 'INVALID_REQUEST');
    }

    const job = await queueWebhook({ url, method, headers, body, timeout });

    res.status(202).json({
      message: 'Webhook queued for delivery',
      jobId: job.id,
      status: job.status,
      queue: job.queue,
    });
  })
);

/**
 * GET /api/v1/queue/jobs
 * Get all queued jobs or filter by queue/status
 */
queueRouter.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const queue = req.query.queue as string | undefined;
    const status = req.query.status as string | undefined;

    let jobs = messageQueue.getAllJobs();

    if (queue) {
      jobs = messageQueue.getJobsByQueue(queue);
    } else if (status) {
      if (!allowedStatuses.includes(status as JobStatus)) {
        throw new AppError(400, `Invalid status: ${status}`, 'INVALID_REQUEST');
      }
      jobs = messageQueue.getJobsByStatus(status as JobStatus);
    }

    res.json({
      data: jobs,
      count: jobs.length,
      timestamp: new Date(),
    });
  })
);

/**
 * GET /api/v1/queue/jobs/:jobId
 * Get a specific job by ID
 */
queueRouter.get(
  '/jobs/:jobId',
  asyncHandler(async (req, res) => {
    const jobId = getParamAsString(req.params.jobId);
    const job = messageQueue.getJob(jobId);

    if (!job) {
      throw new AppError(404, `Job not found: ${jobId}`, 'JOB_NOT_FOUND');
    }

    res.json({
      data: job,
      timestamp: new Date(),
    });
  })
);

/**
 * POST /api/v1/queue/jobs/:jobId/retry
 * Retry a failed job
 */
queueRouter.post(
  '/jobs/:jobId/retry',
  asyncHandler(async (req, res) => {
    const jobId = getParamAsString(req.params.jobId);
    const retried = messageQueue.retryJob(jobId);

    if (!retried) {
      throw new AppError(400, 'Job cannot be retried', 'INVALID_STATE');
    }

    res.json({
      message: 'Job scheduled for retry',
      jobId,
      timestamp: new Date(),
    });
  })
);

/**
 * DELETE /api/v1/queue/jobs/:jobId
 * Delete a job
 */
queueRouter.delete(
  '/jobs/:jobId',
  asyncHandler(async (req, res) => {
    const jobId = getParamAsString(req.params.jobId);
    const deleted = messageQueue.deleteJob(jobId);

    if (!deleted) {
      throw new AppError(404, `Job not found: ${jobId}`, 'JOB_NOT_FOUND');
    }

    res.json({
      message: 'Job deleted',
      jobId,
      timestamp: new Date(),
    });
  })
);

/**
 * GET /api/v1/queue/stats
 * Get queue statistics
 */
queueRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const stats = messageQueue.getStats();

    res.json({
      data: stats,
      timestamp: new Date(),
    });
  })
);

/**
 * DELETE /api/v1/queue/clear
 * Clear jobs by status
 */
queueRouter.delete(
  '/clear',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;

    if (!status) {
      throw new AppError(400, 'Status query parameter is required', 'INVALID_REQUEST');
    }

    if (!allowedStatuses.includes(status as JobStatus)) {
      throw new AppError(400, `Invalid status: ${status}`, 'INVALID_REQUEST');
    }

    const cleared = messageQueue.clearByStatus(status as JobStatus);

    res.json({
      message: `Cleared ${cleared} jobs with status: ${status}`,
      cleared,
      timestamp: new Date(),
    });
  })
);
