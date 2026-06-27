import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { streamingExportService } from '../services/exports/streaming-export.js';
import { auditService } from '../services/auditService.js';
import { pipeStreamToResponse } from '../middleware/stream-cancel.js';
import type { ExportFormat } from '../services/exports/streaming-export.js';
import type { AuditEntry, AuditQuery } from '../services/auditService.js';

export const streamingExportRouter = Router();

/**
 * GET /audit/stream?format=csv|jsonl&userId=X&action=Y&startDate=Z&endDate=W&limit=N
 * Stream audit log entries using cursor-based pagination.
 */
streamingExportRouter.get('/audit/stream', asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as ExportFormat) || 'csv';
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  if (format !== 'csv' && format !== 'jsonl') {
    res.status(400).json({ error: 'Format must be csv or jsonl' });
    return;
  }

  const jobResult = streamingExportService.startExport({ format });
  if (!jobResult.ok) {
    res.status(jobResult.error.statusCode).json({ error: jobResult.error });
    return;
  }

  const job = jobResult.value;
  const query: AuditQuery = {
    userId: req.query.userId as string | undefined,
    action: req.query.action as string | undefined,
    resource: req.query.resource as string | undefined,
    startDate: req.query.startDate ? Number(req.query.startDate) : undefined,
    endDate: req.query.endDate ? Number(req.query.endDate) : undefined,
  };

  const csvHeaders = [
    'ID', 'Timestamp', 'User ID', 'Action', 'Resource', 'Resource ID',
    'IP Address', 'Request Method', 'Request Path', 'Response Status',
    'Previous Hash', 'Hash', 'Suspicious', 'Flags',
  ];

  let pageOffset = 0;
  const pageSize = 500;

  const stream = streamingExportService.createCursorStream<AuditEntry>({
    exportId: job.id,
    format,
    headers: csvHeaders,
    rowLimit: limit,
    fetchPage: async (cursor, chunkLimit) => {
      const offset = cursor ? Number(cursor) : pageOffset;
      const result = await auditService.queryEntries({
        ...query,
        limit: chunkLimit,
        offset,
      });

      pageOffset = offset + result.entries.length;
      return {
        data: result.entries,
        nextCursor: result.entries.length === chunkLimit ? String(pageOffset) : undefined,
      };
    },
    rowSerializer: (entry) => {
      return [
        entry.id,
        new Date(entry.timestamp).toISOString(),
        entry.userId || '',
        entry.action,
        entry.resource,
        entry.resourceId || '',
        entry.ipAddress || '',
        entry.requestMethod || '',
        entry.requestPath || '',
        entry.responseStatus || '',
        entry.previousHash,
        entry.hash,
        entry.suspicious ? 'YES' : 'NO',
        (entry.flags || []).join(';'),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    },
  });

  const ext = format === 'csv' ? 'csv' : 'jsonl';
  const contentType = format === 'csv' ? 'text/csv' : 'application/x-ndjson';

  pipeStreamToResponse({
    stream,
    res,
    req,
    exportId: job.id,
    filename: `audit-export-${Date.now()}.${ext}`,
    contentType,
  });
}));

/**
 * GET /payments/stream?format=csv|jsonl&from=ISO&to=ISO&limit=N
 * Stream payment records using cursor-based pagination.
 * Uses in-memory demo data; in production this would query Prisma.
 */
streamingExportRouter.get('/payments/stream', asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as ExportFormat) || 'csv';
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  if (format !== 'csv' && format !== 'jsonl') {
    res.status(400).json({ error: 'Format must be csv or jsonl' });
    return;
  }

  const jobResult = streamingExportService.startExport({ format });
  if (!jobResult.ok) {
    res.status(jobResult.error.statusCode).json({ error: jobResult.error });
    return;
  }

  const job = jobResult.value;

  const csvHeaders = [
    'ID', 'Amount', 'Currency', 'Status', 'Sender', 'Recipient', 'Created At',
  ];

  const stream = streamingExportService.createCursorStream<Record<string, unknown>>({
    exportId: job.id,
    format,
    headers: csvHeaders,
    rowLimit: limit,
    fetchPage: async (_cursor, _chunkLimit) => {
      // Placeholder: in production, use Prisma cursor-based pagination:
      // const payments = await prisma.payment.findMany({
      //   take: chunkLimit,
      //   skip: cursor ? 1 : 0,
      //   cursor: cursor ? { id: cursor } : undefined,
      //   where: { createdAt: { gte: from, lte: to } },
      //   orderBy: { createdAt: 'asc' },
      // });
      return { data: [], nextCursor: undefined };
    },
    rowSerializer: (item) => {
      return [
        item.id ?? '',
        item.amount ?? '',
        item.currency ?? '',
        item.status ?? '',
        item.sender ?? '',
        item.recipient ?? '',
        item.createdAt ?? '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    },
  });

  const ext = format === 'csv' ? 'csv' : 'jsonl';
  const contentType = format === 'csv' ? 'text/csv' : 'application/x-ndjson';

  pipeStreamToResponse({
    stream,
    res,
    req,
    exportId: job.id,
    filename: `payments-export-${Date.now()}.${ext}`,
    contentType,
  });
}));

/**
 * GET /:exportId/status
 * Get export job status and progress.
 */
streamingExportRouter.get('/:exportId/status', asyncHandler(async (req: Request, res: Response) => {
  const { exportId } = req.params;
  const result = streamingExportService.getJob(exportId);

  if (!result.ok) {
    res.status(result.error.statusCode).json({ error: result.error });
    return;
  }

  const job = result.value;
  const progress = job.totalEstimate
    ? Math.min(100, Math.round((job.rowsProcessed / job.totalEstimate) * 100))
    : undefined;

  res.status(200).json({ ...job, progress });
}));

/**
 * DELETE /:exportId
 * Cancel an in-progress export.
 */
streamingExportRouter.delete('/:exportId', asyncHandler(async (req: Request, res: Response) => {
  const { exportId } = req.params;
  const result = streamingExportService.cancelExport(exportId);

  if (!result.ok) {
    res.status(result.error.statusCode).json({ error: result.error });
    return;
  }

  res.status(200).json(result.value);
}));

/**
 * GET /jobs
 * List all export jobs.
 */
streamingExportRouter.get('/jobs/list', asyncHandler(async (_req: Request, res: Response) => {
  const jobs = streamingExportService.listJobs();
  res.status(200).json({ jobs, activeCount: streamingExportService.activeStreamCount });
}));
