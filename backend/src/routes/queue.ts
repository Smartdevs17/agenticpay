import { Router } from 'express';
import { messageQueue, JobStatus, JobPriority, QueueName } from '../services/queue.js';
import {
  queueEmail,
  queueNotification,
  queueWebhook,
  EmailJobData,
  NotificationJobData,
  WebhookJobData,
} from '../services/queue-producers.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { paginateArray } from '../utils/pagination.js';

export const queueRouter = Router();

const allowedStatuses: JobStatus[] = ['pending', 'processing', 'completed', 'failed', 'retrying', 'dlq'];
const allowedPriorities: JobPriority[] = ['critical', 'high', 'normal', 'low'];

function getParamAsString(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}

function parsePriority(val: string | undefined): JobPriority {
  if (val && allowedPriorities.includes(val as JobPriority)) return val as JobPriority;
  return 'normal';
}

queueRouter.post(
  '/email',
  asyncHandler(async (req, res) => {
    const { to, subject, body, html, from, priority, tags } = req.body;
    if (!to || !subject || !body) {
      throw new AppError(400, 'Missing required fields: to, subject, body', 'INVALID_REQUEST');
    }
    const job = await queueEmail({ to, subject, body, html, from }, {
      priority: parsePriority(priority),
      tags: Array.isArray(tags) ? tags : undefined,
    });
    res.status(202).json({ message: 'Email queued for delivery', jobId: job.id, status: job.status, queue: job.queue, priority: job.priority });
  })
);

queueRouter.post(
  '/notification',
  asyncHandler(async (req, res) => {
    const { userId, type, title, message, metadata, priority, tags } = req.body;
    if (!userId || !type || !title || !message) {
      throw new AppError(400, 'Missing required fields: userId, type, title, message', 'INVALID_REQUEST');
    }
    const job = await queueNotification({ userId, type, title, message, metadata }, {
      priority: parsePriority(priority),
      tags: Array.isArray(tags) ? tags : undefined,
    });
    res.status(202).json({ message: 'Notification queued for delivery', jobId: job.id, status: job.status, queue: job.queue, priority: job.priority });
  })
);

queueRouter.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const { url, method = 'POST', headers, body, timeout, priority, tags } = req.body;
    if (!url) {
      throw new AppError(400, 'Missing required field: url', 'INVALID_REQUEST');
    }
    const job = await queueWebhook({ url, method, headers, body, timeout }, {
      priority: parsePriority(priority),
      tags: Array.isArray(tags) ? tags : undefined,
    });
    res.status(202).json({ message: 'Webhook queued for delivery', jobId: job.id, status: job.status, queue: job.queue, priority: job.priority });
  })
);

queueRouter.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const queue = req.query.queue as string | undefined;
    const status = req.query.status as string | undefined;
    const priority = req.query.priority as string | undefined;

    let jobs = messageQueue.getAllJobs();

    if (queue) jobs = messageQueue.getJobsByQueue(queue);
    else if (status) {
      if (!allowedStatuses.includes(status as JobStatus)) {
        throw new AppError(400, `Invalid status: ${status}`, 'INVALID_REQUEST');
      }
      jobs = messageQueue.getJobsByStatus(status as JobStatus);
    } else if (priority) {
      if (!allowedPriorities.includes(priority as JobPriority)) {
        throw new AppError(400, `Invalid priority: ${priority}`, 'INVALID_REQUEST');
      }
      jobs = messageQueue.getJobsByPriority(priority as JobPriority);
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
    const paginated = paginateArray(jobs, { limit, offset });

    res.json({ data: paginated.data, total: paginated.total, limit: paginated.limit, offset: paginated.offset, timestamp: new Date() });
  })
);

queueRouter.get(
  '/jobs/:jobId',
  asyncHandler(async (req, res) => {
    const jobId = getParamAsString(req.params.jobId);
    const job = messageQueue.getJob(jobId);
    if (!job) throw new AppError(404, `Job not found: ${jobId}`, 'JOB_NOT_FOUND');
    res.json({ data: job, timestamp: new Date() });
  })
);

queueRouter.post(
  '/jobs/:jobId/retry',
  asyncHandler(async (req, res) => {
    const jobId = getParamAsString(req.params.jobId);
    const retried = messageQueue.retryJob(jobId);
    if (!retried) throw new AppError(400, 'Job cannot be retried', 'INVALID_STATE');
    res.json({ message: 'Job scheduled for retry', jobId, timestamp: new Date() });
  })
);

queueRouter.delete(
  '/jobs/:jobId',
  asyncHandler(async (req, res) => {
    const jobId = getParamAsString(req.params.jobId);
    const deleted = messageQueue.deleteJob(jobId);
    if (!deleted) throw new AppError(404, `Job not found: ${jobId}`, 'JOB_NOT_FOUND');
    res.json({ message: 'Job deleted', jobId, timestamp: new Date() });
  })
);

queueRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const stats = messageQueue.getStats();
    res.json({ data: stats, timestamp: new Date() });
  })
);

queueRouter.get(
  '/metrics',
  asyncHandler(async (req, res) => {
    const metrics = messageQueue.getMetrics();
    res.json({ data: metrics, timestamp: new Date() });
  })
);

queueRouter.get(
  '/rate-limits',
  asyncHandler(async (req, res) => {
    const limits = messageQueue.getRateLimitStatus();
    res.json({ data: limits, timestamp: new Date() });
  })
);

queueRouter.delete(
  '/clear',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    if (!status) throw new AppError(400, 'Status query parameter is required', 'INVALID_REQUEST');
    if (!allowedStatuses.includes(status as JobStatus)) {
      throw new AppError(400, `Invalid status: ${status}`, 'INVALID_REQUEST');
    }
    const cleared = messageQueue.clearByStatus(status as JobStatus);
    res.json({ message: `Cleared ${cleared} jobs with status: ${status}`, cleared, timestamp: new Date() });
  })
);

queueRouter.get(
  '/dlq',
  asyncHandler(async (req, res) => {
    const dlq = messageQueue.getDlq();
    const queue = req.query.queue as string | undefined;
    const filtered = queue ? dlq.filter((e) => e.originalQueue === queue) : dlq;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
    const paginated = paginateArray(filtered, { limit, offset });
    res.json({ data: paginated.data, total: paginated.total, timestamp: new Date() });
  })
);

queueRouter.post(
  '/dlq/:jobId/replay',
  asyncHandler(async (req, res) => {
    const jobId = getParamAsString(req.params.jobId);
    const replayed = messageQueue.replayFromDlq(jobId);
    if (!replayed) throw new AppError(404, `Job not found in DLQ: ${jobId}`, 'JOB_NOT_FOUND');
    res.json({ message: 'Job replayed from DLQ', jobId, timestamp: new Date() });
  })
);

queueRouter.post(
  '/dlq/replay-all',
  asyncHandler(async (req, res) => {
    const queue = req.query.queue as QueueName | undefined;
    const count = messageQueue.replayAllFromDlq(queue);
    res.json({ message: `Replayed ${count} job(s) from DLQ`, count, timestamp: new Date() });
  })
);

queueRouter.delete(
  '/dlq/:jobId',
  asyncHandler(async (req, res) => {
    const jobId = getParamAsString(req.params.jobId);
    const deleted = messageQueue.deleteFromDlq(jobId);
    if (!deleted) throw new AppError(404, `Job not found in DLQ: ${jobId}`, 'JOB_NOT_FOUND');
    res.json({ message: 'Job deleted from DLQ', jobId, timestamp: new Date() });
  })
);

queueRouter.delete(
  '/dlq/clear',
  asyncHandler(async (req, res) => {
    const count = messageQueue.clearDlq();
    res.json({ message: `Cleared ${count} job(s) from DLQ`, cleared: count, timestamp: new Date() });
  })
);