import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';
import {
  parseCSV,
  detectDuplicates,
  executeBatch,
  getBatch,
  listBatches,
  getBatchReport,
  generateCSVTemplate,
} from '../services/batch.js';
import { batchSubmitSchema } from '../schemas/batch.js';

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

// POST /parse — parse & validate CSV, return preview with duplicate detection
batchRouter.post(
  '/parse',
  asyncHandler(async (req, res) => {
    const contentType = req.headers['content-type'] ?? '';

    let csvText: string;
    if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
      csvText = req.body as string;
    } else if (typeof req.body?.csv === 'string') {
      csvText = req.body.csv;
    } else {
      throw new AppError(400, 'Provide CSV as text/csv body or JSON { csv: "..." }', 'VALIDATION_ERROR');
    }

    const { rows, errors } = parseCSV(csvText);
    const duplicateIndices = detectDuplicates(rows);

    res.json({
      total: rows.length,
      valid: rows.length,
      parseErrors: errors,
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
