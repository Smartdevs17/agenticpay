import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { customReportService } from '../services/reports/custom-report.js';
import { AppError } from '../middleware/errorHandler.js';
import { exportReportRows, type ReportExportFormat } from '../services/reports/report-export.js';
import { reconciliationReportService } from '../services/reports/reconciliation-report.js';
import { financialStatementService } from '../services/reports/financial-statements.js';
import { merchantSettlementService } from '../services/reports/merchant-settlement.js';
import { payoutFailureAnalyticsService } from '../services/payouts/payout-failure-analytics.js';

export const reportsRouter = Router();

function resolveTenant(req: any): string {
  return (req.headers['x-tenant-id'] as string) ?? 'default';
}

function requirePeriod(body: any): { dateFrom: string; dateTo: string } {
  const { dateFrom, dateTo } = body ?? {};
  if (!dateFrom || !dateTo) {
    throw new AppError(400, 'dateFrom and dateTo are required', 'VALIDATION_ERROR');
  }
  return { dateFrom, dateTo };
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'report';
}

// ── Reconciliation report (Issue #937) ──────────────────────────────────────

reportsRouter.post(
  '/reconciliation',
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenant(req);
    const { dateFrom, dateTo } = requirePeriod(req.body);
    const { chain, status, format } = req.body ?? {};

    const { report, csv, pdf } = await reconciliationReportService.generateReport({
      dateFrom,
      dateTo,
      tenantId,
      ...(chain ? { chain } : {}),
      ...(status ? { status } : {}),
      format: format ?? 'json',
    });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="reconciliation-${safeFileName(dateFrom)}-${safeFileName(dateTo)}.csv"`);
      return res.send(csv);
    }

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="reconciliation-${safeFileName(dateFrom)}-${safeFileName(dateTo)}.pdf"`);
      return res.send(pdf);
    }

    res.json({ report, csv });
  }),
);

// ── Financial statement (Issue #940) ─────────────────────────────────────────

reportsRouter.post(
  '/financial-statement',
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenant(req);
    const { dateFrom, dateTo } = requirePeriod(req.body);
    const { chain, status, currency, format } = req.body ?? {};
    const userId = (req as any).user?.id;

    const filters = {
      tenantId,
      dateFrom,
      dateTo,
      ...(chain ? { chain } : {}),
      ...(status ? { status } : {}),
      ...(currency ? { currency } : {}),
    };

    const { statement, csv, pdf, jobId } = await financialStatementService.generateStatementJob(
      filters,
      userId,
    );

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="financial-statement-${safeFileName(dateFrom)}-${safeFileName(dateTo)}.csv"`);
      return res.send(csv);
    }

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="financial-statement-${safeFileName(dateFrom)}-${safeFileName(dateTo)}.pdf"`);
      return res.send(pdf);
    }

    res.json({ statement, jobId });
  }),
);

reportsRouter.get(
  '/financial-statement/jobs',
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenant(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    res.json(await financialStatementService.listStatementJobs(tenantId, page, limit));
  }),
);

reportsRouter.get(
  '/financial-statement/jobs/:id',
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenant(req);
    res.json(await financialStatementService.getStatementJob(String(req.params.id), tenantId));
  }),
);

// ── Merchant settlement report (Issue #938) ──────────────────────────────────

reportsRouter.post(
  '/settlement',
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenant(req);
    const { dateFrom, dateTo } = requirePeriod(req.body);
    const { chain, status, currency, merchantId, format } = req.body ?? {};
    const userId = (req as any).user?.id;

    const filters = {
      tenantId,
      dateFrom,
      dateTo,
      ...(chain ? { chain } : {}),
      ...(status ? { status } : {}),
      ...(currency ? { currency } : {}),
      ...(merchantId ? { merchantId } : {}),
    };

    const { report, csv, pdf, jobId } = await merchantSettlementService.generateSettlementJob(
      filters,
      userId,
    );

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="merchant-settlement-${safeFileName(dateFrom)}-${safeFileName(dateTo)}.csv"`);
      return res.send(csv);
    }

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="merchant-settlement-${safeFileName(dateFrom)}-${safeFileName(dateTo)}.pdf"`);
      return res.send(pdf);
    }

    res.json({ report, jobId });
  }),
);

reportsRouter.get(
  '/settlement',
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenant(req);
    const { dateFrom, dateTo } = requirePeriod(req.query);
    const { chain, status, currency, merchantId } = req.query as Record<string, string | undefined>;

    const { report } = await merchantSettlementService.generateReport({
      tenantId,
      dateFrom,
      dateTo,
      ...(chain ? { chain } : {}),
      ...(status ? { status } : {}),
      ...(currency ? { currency } : {}),
      ...(merchantId ? { merchantId } : {}),
    });

    res.json({ report });
  }),
);

// ── Payout failure analytics (Issue #939) ────────────────────────────────────

reportsRouter.get(
  '/payout-failure-analytics',
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenant(req);
    const { dateFrom, dateTo, merchantId, asset } = req.query as Record<string, string | undefined>;
    if (!dateFrom || !dateTo) {
      throw new AppError(400, 'dateFrom and dateTo are required', 'VALIDATION_ERROR');
    }

    const analytics = await payoutFailureAnalyticsService.generateAnalytics({
      tenantId,
      dateFrom,
      dateTo,
      ...(merchantId ? { merchantId } : {}),
      ...(asset ? { asset } : {}),
    });

    res.json({ analytics });
  }),
);

// ── Saved custom reports ────────────────────────────────────────────────────

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

reportsRouter.get('/templates/list', asyncHandler(async (_req, res) => {
  const templates = await customReportService.listTemplates();
  res.json({ templates });
}));

reportsRouter.get('/:id', asyncHandler(async (req, res) => {
  const report = await customReportService.getReport(String(req.params.id));
  res.json(report);
}));

reportsRouter.put('/:id', asyncHandler(async (req, res) => {
  const report = await customReportService.updateReport(String(req.params.id), req.body);
  res.json(report);
}));

reportsRouter.delete('/:id', asyncHandler(async (req, res) => {
  await customReportService.deleteReport(String(req.params.id));
  res.json({ success: true });
}));

reportsRouter.post('/:id/favorite', asyncHandler(async (req, res) => {
  const report = await customReportService.toggleFavorite(String(req.params.id));
  res.json(report);
}));

reportsRouter.post('/:id/pin', asyncHandler(async (req, res) => {
  const report = await customReportService.togglePinned(String(req.params.id));
  res.json(report);
}));

reportsRouter.post('/:id/schedule', asyncHandler(async (req, res) => {
  const schedule = await customReportService.scheduleReport({ reportId: String(req.params.id), ...req.body });
  res.json(schedule);
}));

reportsRouter.delete('/:id/schedule', asyncHandler(async (req, res) => {
  await customReportService.unscheduleReport(String(req.params.id));
  res.json({ success: true });
}));

reportsRouter.post('/:id/template', asyncHandler(async (req, res) => {
  const { name, description, isPublic } = req.body as { name: string; description?: string; isPublic?: boolean };
  if (!name) throw new AppError(400, 'Template name required', 'MISSING_NAME');
  const template = await customReportService.saveAsTemplate(String(req.params.id), name, description, isPublic);
  res.status(201).json(template);
}));

reportsRouter.get('/:id/data', asyncHandler(async (req, res) => {
  const data = await customReportService.generateReportData(String(req.params.id));
  res.json(data);
}));

reportsRouter.get('/:id/export', asyncHandler(async (req, res) => {
  const format = req.query.format as ReportExportFormat | undefined;
  if (format !== 'csv' && format !== 'json' && format !== 'excel') {
    throw new AppError(400, 'format must be csv, json, or excel', 'INVALID_EXPORT_FORMAT');
  }

  const generated = await customReportService.generateReportData(String(req.params.id));
  const exported = exportReportRows(generated.data as Record<string, unknown>[], format);
  const safeName = generated.report.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'report';

  res.setHeader('Content-Type', exported.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.${exported.extension}"`);
  res.send(exported.content);
}));
