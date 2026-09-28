import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';
import {
  parseCSV,
  detectDuplicates,
  executeBatch,
  estimateBatch,
  getBatch,
  listBatches,
  getBatchReport,
  generateCSVTemplate,
  scheduleBatch,
  listScheduledBatches,
  cancelScheduledBatch,
  getScheduledBatch,
} from '../services/batch.js';
import { batchSubmitSchema, batchPaymentRowSchema } from '../schemas/batch.js';
import type { BatchPaymentRow } from '../schemas/batch.js';

export const batchRouter = Router();

// GET /template — download CSV template
batchRouter.get(
  '/template',
  asyncHandler(async (_req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="batch_payment_template.csv"');
    res.send(generateCSVTemplate());
  })
);

// POST /parse — parse & validate CSV or JSON, return preview with duplicate detection
batchRouter.post(
  '/parse',
  asyncHandler(async (req, res) => {
    const contentType = req.headers['content-type'] ?? '';

    let rows: BatchPaymentRow[] = [];
    let parseErrors: Array<{ line: number; error: string }> = [];

    if (contentType.includes('application/json') && Array.isArray(req.body?.payments)) {
      // JSON upload support
      const result = batchSubmitSchema.safeParse(req.body);
      if (!result.success) {
        throw new AppError(400, JSON.stringify(result.error.issues), 'VALIDATION_ERROR');
      }
      rows = result.data.payments;
    } else {
      // CSV upload
      let csvText: string;
      if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
        csvText = req.body as string;
      } else if (typeof req.body?.csv === 'string') {
        csvText = req.body.csv;
      } else {
        throw new AppError(400, 'Provide CSV as text/csv body or JSON { payments: [...] }', 'VALIDATION_ERROR');
      }
      const parsed = parseCSV(csvText);
      rows = parsed.rows;
      parseErrors = parsed.errors;
    }
    const duplicateIndices = detectDuplicates(rows);

    res.json({
      total: rows.length,
      valid: rows.length,
      parseErrors,
      duplicates: duplicateIndices,
      preview: rows,
    });
  })
);

// POST /submit — submit JSON payment list for execution
batchRouter.post(
  '/submit',
  validate(batchSubmitSchema),
  asyncHandler(async (req, res) => {
    const { payments, label } = req.body;

    const duplicates = detectDuplicates(payments);
    if (duplicates.length > 0) {
      // Warn but don't block — caller can use /parse to preview first
    }

    const record = executeBatch(payments, label);
    res.status(201).json(record);
  })
);

// GET / — list all batches
batchRouter.get(
  '/',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (_req, res) => {
    res.json({ batches: listBatches() });
  })
);

// GET /:id — get batch status / progress
batchRouter.get(
  '/:id',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const record = getBatch(id);
    if (!record) throw new AppError(404, 'Batch not found', 'NOT_FOUND');
    res.json(record);
  })
);

// GET /:id/report — full batch report
batchRouter.get(
  '/:id/report',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const report = getBatchReport(id);
    if (!report) throw new AppError(404, 'Batch not found', 'NOT_FOUND');
    res.json(report);
  })
);

// POST /estimate — dry-run estimation before submission
const batchEstimateSchema = z.object({
  payments: z.array(batchPaymentRowSchema).min(1).max(1000),
});

batchRouter.post(
  '/estimate',
  validate(batchEstimateSchema),
  asyncHandler(async (req, res) => {
    const estimate = estimateBatch(req.body.payments);
    res.json(estimate);
  })
);

// POST /schedule — schedule batch for later execution
const batchScheduleSchema = z.object({
  payments: z.array(batchPaymentRowSchema).min(1).max(1000),
  label: z.string().max(100).optional(),
  executeAt: z.string().min(1), // ISO 8601 datetime
});

batchRouter.post(
  '/schedule',
  validate(batchScheduleSchema),
  asyncHandler(async (req, res) => {
    const { payments, label, executeAt } = req.body;
    const scheduled = scheduleBatch(payments, executeAt, label);
    res.status(201).json(scheduled);
  })
);

// GET /scheduled — list all scheduled batches
batchRouter.get(
  '/scheduled',
  asyncHandler(async (_req, res) => {
    res.json({ batches: listScheduledBatches() });
  })
);

// GET /scheduled/:id — get scheduled batch details
batchRouter.get(
  '/scheduled/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const batch = getScheduledBatch(id);
    if (!batch) throw new AppError(404, 'Scheduled batch not found', 'NOT_FOUND');
    res.json(batch);
  })
);

// DELETE /scheduled/:id — cancel a scheduled batch
batchRouter.delete(
  '/scheduled/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const batch = cancelScheduledBatch(id);
    if (!batch) throw new AppError(404, 'Scheduled batch not found or not cancellable', 'NOT_FOUND');
    res.json(batch);
  })
);
