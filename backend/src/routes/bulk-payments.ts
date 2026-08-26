import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { bulkProcessorService } from '../services/payments/bulk-processor.js';
import { AppError } from '../middleware/errorHandler.js';

export const bulkPaymentsRouter = Router();

bulkPaymentsRouter.post('/validate', asyncHandler(async (req, res) => {
  const { rows, columnMapping } = req.body;
  const tenantId = req.headers['x-tenant-id'] as string;

  if (!rows || !columnMapping || !tenantId) {
    throw new AppError(400, 'rows, columnMapping, and x-tenant-id are required', 'VALIDATION_ERROR');
  }

  const result = await bulkProcessorService.parseAndValidate(rows, columnMapping, tenantId);
  res.json(result);
}));

bulkPaymentsRouter.post('/upload', asyncHandler(async (req, res) => {
  const { rows, columnMapping, fileName, fileSize, mimeType } = req.body;
  const tenantId = req.headers['x-tenant-id'] as string;
  const userId = (req as any).user?.id;

  if (!rows || !columnMapping || !fileName || !tenantId) {
    throw new AppError(400, 'rows, columnMapping, fileName, and x-tenant-id are required', 'VALIDATION_ERROR');
  }

  const validation = await bulkProcessorService.parseAndValidate(rows, columnMapping, tenantId);

  const bulk = await bulkProcessorService.createBulkUpload(
    tenantId, userId, fileName, fileSize || 0, mimeType || 'text/csv',
    columnMapping, validation.rows,
  );

  res.json({
    bulkUploadId: bulk.id,
    totalRows: validation.rows.length,
    validCount: validation.validCount,
    errorCount: validation.errorCount,
    rows: validation.rows,
  });
}));

bulkPaymentsRouter.post('/:id/process', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const result = await bulkProcessorService.processBulkUpload(req.params.id, tenantId);
  res.json(result);
}));

bulkPaymentsRouter.get('/:id', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const bulk = await bulkProcessorService.getBulkUpload(req.params.id, tenantId);
  res.json(bulk);
}));

bulkPaymentsRouter.get('/', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const result = await bulkProcessorService.listBulkUploads(tenantId, page, limit);
  res.json(result);
}));

bulkPaymentsRouter.get('/:id/error-report', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const csv = await bulkProcessorService.generateErrorReport(req.params.id, tenantId);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="bulk-errors-${req.params.id}.csv"`);
  res.send(csv);
}));

bulkPaymentsRouter.get('/template', asyncHandler(async (_req, res) => {
  const header = 'amount,destination,currency,memo,chain';
  const sample = '100.50,GAX3...ABC,XLM,Payment for services,stellar';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bulk-payment-template.csv"');
  res.send(`${header}\n${sample}\n`);
}));
