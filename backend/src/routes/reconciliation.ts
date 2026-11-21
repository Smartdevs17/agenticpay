import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { reconciliationReportService } from '../services/reports/reconciliation-report.js';
import { AppError } from '../middleware/errorHandler.js';

export const reconciliationRouter = Router();

reconciliationRouter.post('/generate', asyncHandler(async (req, res) => {
  const { dateFrom, dateTo, chain, status, format } = req.body;
  const tenantId = req.headers['x-tenant-id'] as string;
  const userId = (req as any).user?.id;

  if (!dateFrom || !dateTo) {
    throw new AppError(400, 'dateFrom and dateTo are required', 'VALIDATION_ERROR');
  }
  if (!tenantId) {
    throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');
  }

  const result = await reconciliationReportService.generateReport({
    dateFrom, dateTo, tenantId, chain, status, format: format || 'csv',
  });

  const job = await reconciliationReportService.saveReportJob(
    tenantId, userId, dateFrom, dateTo, format || 'csv',
    { chain, status },
  );

  if (format === 'pdf') {
    await reconciliationReportService.createArchive(job.id, 'pdf', `reports/reconciliation-${job.id}.pdf`, result.report.rows.length, result.pdf.length);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reconciliation-${dateFrom}-${dateTo}.pdf"`);
    return res.send(result.pdf);
  }

  await reconciliationReportService.createArchive(job.id, 'csv', `reports/reconciliation-${job.id}.csv`, result.report.rows.length, result.csv.length);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="reconciliation-${dateFrom}-${dateTo}.csv"`);
  res.send(result.csv);
}));

reconciliationRouter.post('/preview', asyncHandler(async (req, res) => {
  const { dateFrom, dateTo, chain, status } = req.body;
  const tenantId = req.headers['x-tenant-id'] as string;

  if (!dateFrom || !dateTo || !tenantId) {
    throw new AppError(400, 'dateFrom, dateTo, and x-tenant-id are required', 'VALIDATION_ERROR');
  }

  const result = await reconciliationReportService.generateReport({
    dateFrom, dateTo, tenantId, chain, status,
  });

  res.json({
    rows: result.report.rows.slice(0, 100),
    totalRows: result.report.rows.length,
    dailySummaries: result.report.dailySummaries,
    weeklySummaries: result.report.weeklySummaries,
    monthlySummaries: result.report.monthlySummaries,
    dateFrom: result.report.dateFrom,
    dateTo: result.report.dateTo,
    generatedAt: result.report.generatedAt,
  });
}));

reconciliationRouter.get('/jobs', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const result = await reconciliationReportService.listJobs(tenantId, page, limit);
  res.json(result);
}));

reconciliationRouter.get('/jobs/:id', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const job = await reconciliationReportService.getJob(req.params.id, tenantId);
  res.json(job);
}));

reconciliationRouter.delete('/jobs/:id', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  await reconciliationReportService.deleteJob(req.params.id, tenantId);
  res.json({ success: true });
}));
