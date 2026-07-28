import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { customReportService } from '../services/reports/custom-report.js';
import { AppError } from '../middleware/errorHandler.js';

export const reportsRouter = Router();

function resolveTenant(req: any): string {
  return (req.headers['x-tenant-id'] as string) ?? 'default';
}

reportsRouter.post('/', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const report = await customReportService.createReport({ ...req.body, tenantId });
  res.status(201).json(report);
}));

reportsRouter.get('/', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const { userId, isFavorite, search, limit } = req.query as any;
  const reports = await customReportService.listReports(tenantId, {
    userId,
    isFavorite: isFavorite === 'true' ? true : isFavorite === 'false' ? false : undefined,
    search,
    limit: limit ? parseInt(limit) : undefined,
  });
  res.json({ reports });
}));

reportsRouter.get('/:id', asyncHandler(async (req, res) => {
  const report = await customReportService.getReport(req.params.id);
  res.json(report);
}));

reportsRouter.put('/:id', asyncHandler(async (req, res) => {
  const report = await customReportService.updateReport(req.params.id, req.body);
  res.json(report);
}));

reportsRouter.delete('/:id', asyncHandler(async (req, res) => {
  await customReportService.deleteReport(req.params.id);
  res.json({ success: true });
}));

reportsRouter.post('/:id/favorite', asyncHandler(async (req, res) => {
  const report = await customReportService.toggleFavorite(req.params.id);
  res.json(report);
}));

reportsRouter.post('/:id/pin', asyncHandler(async (req, res) => {
  const report = await customReportService.togglePinned(req.params.id);
  res.json(report);
}));

reportsRouter.post('/:id/schedule', asyncHandler(async (req, res) => {
  const schedule = await customReportService.scheduleReport({ reportId: req.params.id, ...req.body });
  res.json(schedule);
}));

reportsRouter.delete('/:id/schedule', asyncHandler(async (req, res) => {
  await customReportService.unscheduleReport(req.params.id);
  res.json({ success: true });
}));

reportsRouter.post('/:id/template', asyncHandler(async (req, res) => {
  const { name, description, isPublic } = req.body as { name: string; description?: string; isPublic?: boolean };
  if (!name) throw new AppError(400, 'Template name required', 'MISSING_NAME');
  const template = await customReportService.saveAsTemplate(req.params.id, name, description, isPublic);
  res.status(201).json(template);
}));

reportsRouter.get('/templates/list', asyncHandler(async (_req, res) => {
  const templates = await customReportService.listTemplates();
  res.json({ templates });
}));

reportsRouter.get('/:id/data', asyncHandler(async (req, res) => {
  const data = await customReportService.generateReportData(req.params.id);
  res.json(data);
}));
