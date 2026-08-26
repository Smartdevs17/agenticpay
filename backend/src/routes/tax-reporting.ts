// Tax reporting routes — Issues #690, #691, #692, #693
//
// POST   /api/v1/tax-reporting/reports/generate           — generate an automated tax report
// POST   /api/v1/tax-reporting/reports/generate-batch     — batch generate for multiple merchants
// GET    /api/v1/tax-reporting/reports                    — list generated reports
// GET    /api/v1/tax-reporting/reports/:id                — get a specific report
// POST   /api/v1/tax-reporting/reports/:id/finalize       — finalize a draft report
// POST   /api/v1/tax-reporting/reports/:id/archive        — archive a finalized report
// GET    /api/v1/tax-reporting/reports/:id/export          — export report in specified format
// POST   /api/v1/tax-reporting/filing                      — generate consolidated filing report
// GET    /api/v1/tax-reporting/filing/:id                  — get a filing report
// GET    /api/v1/tax-reporting/filing/:id/export           — export filing report
//
// POST   /api/v1/tax-reporting/calendar/deadlines          — create a tax deadline
// GET    /api/v1/tax-reporting/calendar/deadlines          — list deadlines
// GET    /api/v1/tax-reporting/calendar/deadlines/:id      — get a deadline
// PATCH  /api/v1/tax-reporting/calendar/deadlines/:id      — update a deadline
// POST   /api/v1/tax-reporting/calendar/deadlines/:id/complete — mark deadline completed
// POST   /api/v1/tax-reporting/calendar/deadlines/:id/extend  — extend a deadline
// DELETE /api/v1/tax-reporting/calendar/deadlines/:id      — delete a deadline
// GET    /api/v1/tax-reporting/calendar/alerts             — upcoming deadline alerts
// GET    /api/v1/tax-reporting/calendar/overdue            — overdue deadlines
// GET    /api/v1/tax-reporting/calendar/templates          — default deadline templates
// POST   /api/v1/tax-reporting/calendar/templates/apply    — create deadline from template

import { Router, Request } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { taxReportService } from '../services/tax-reports.js';
import { taxRuleEngine } from '../services/tax/index.js';
import { AutomatedTaxReportService } from '../services/tax/automated-tax-report.js';
import { TaxExportService } from '../services/tax/tax-export.js';
import { TaxCalendarService } from '../services/tax/tax-calendar.js';
import type { Result } from '../lib/result.js';
import type { ExportFormat } from '../services/tax/tax-export.js';
import type { ReportPeriod } from '../services/tax/automated-tax-report.js';
import type { DeadlineFrequency } from '../services/tax/tax-calendar.js';

export const taxReportingRouter = Router();

// Instantiate services
const automatedReportService = new AutomatedTaxReportService(taxRuleEngine, taxReportService);
const exportService = new TaxExportService();
const calendarService = new TaxCalendarService();

// ─── Helpers ────────────────────────────────────────────────────────────

function requireTenantId(req: Request): string {
  const tenantId = req.query.tenantId ?? req.body?.tenantId;
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new AppError(400, 'tenantId is required', 'VALIDATION_ERROR');
  }
  return tenantId;
}

function requireMerchantId(req: Request): string {
  const merchantId = req.query.merchantId ?? req.body?.merchantId;
  if (typeof merchantId !== 'string' || merchantId.length === 0) {
    throw new AppError(400, 'merchantId is required', 'VALIDATION_ERROR');
  }
  return merchantId;
}

function parseYear(req: Request): number {
  const raw = req.query.year ?? req.body?.year;
  if (typeof raw === 'string') {
    const year = parseInt(raw, 10);
    if (!Number.isNaN(year) && year >= 2000 && year <= 2100) return year;
    throw new AppError(400, 'year must be between 2000 and 2100', 'VALIDATION_ERROR');
  }
  if (typeof raw === 'number') {
    if (raw >= 2000 && raw <= 2100) return raw;
    throw new AppError(400, 'year must be between 2000 and 2100', 'VALIDATION_ERROR');
  }
  return new Date().getUTCFullYear();
}

function parseDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new AppError(400, `${field} must be an ISO date string`, 'VALIDATION_ERROR');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, `${field} is not a valid date`, 'VALIDATION_ERROR');
  }
  return date;
}

function unwrap<T>(result: Result<T>): T {
  if (result.ok) {
    return result.value;
  }
  const err = result as { ok: false; error: { statusCode: number; message: string; code: string; details?: Record<string, unknown> } };
  throw new AppError(err.error.statusCode, err.error.message, err.error.code, err.error.details);
}

const VALID_PERIODS: ReportPeriod[] = ['monthly', 'quarterly', 'annual'];
const VALID_EXPORT_FORMATS: ExportFormat[] = ['csv', 'json', 'pdf', 'xlsx'];
const VALID_FREQUENCIES: DeadlineFrequency[] = ['monthly', 'quarterly', 'semi_annual', 'annual'];

function parsePeriod(value: unknown): ReportPeriod {
  if (typeof value === 'string' && (VALID_PERIODS as string[]).includes(value)) {
    return value as ReportPeriod;
  }
  throw new AppError(400, `period must be one of ${VALID_PERIODS.join(', ')}`, 'VALIDATION_ERROR');
}

function parseExportFormat(value: unknown): ExportFormat {
  if (typeof value === 'string' && (VALID_EXPORT_FORMATS as string[]).includes(value)) {
    return value as ExportFormat;
  }
  throw new AppError(400, `format must be one of ${VALID_EXPORT_FORMATS.join(', ')}`, 'VALIDATION_ERROR');
}

function parseFrequency(value: unknown): DeadlineFrequency {
  if (typeof value === 'string' && (VALID_FREQUENCIES as string[]).includes(value)) {
    return value as DeadlineFrequency;
  }
  throw new AppError(400, `frequency must be one of ${VALID_FREQUENCIES.join(', ')}`, 'VALIDATION_ERROR');
}

// ─── Report Generation ──────────────────────────────────────────────────

taxReportingRouter.post(
  '/reports/generate',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const merchantId = requireMerchantId(req);
    const body = req.body as Record<string, unknown>;

    const period = parsePeriod(body.period);
    const year = typeof body.year === 'number' ? body.year : parseYear(req);

    const result = await automatedReportService.generateReport({
      tenantId,
      merchantId,
      period,
      year,
      periodNumber: typeof body.periodNumber === 'number' ? body.periodNumber : undefined,
      jurisdictions: Array.isArray(body.jurisdictions) ? body.jurisdictions as string[] : undefined,
      reportingCurrency: typeof body.reportingCurrency === 'string' ? body.reportingCurrency : undefined,
    });

    res.status(201).json({ data: unwrap(result) });
  })
);

taxReportingRouter.post(
  '/reports/generate-batch',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const body = req.body as Record<string, unknown>;

    if (!Array.isArray(body.merchantIds) || body.merchantIds.length === 0) {
      throw new AppError(400, 'merchantIds array is required', 'VALIDATION_ERROR');
    }

    const period = parsePeriod(body.period);
    const year = typeof body.year === 'number' ? body.year : parseYear(req);

    const result = await automatedReportService.generateScheduledReports({
      tenantId,
      merchantIds: body.merchantIds as string[],
      period,
      year,
      periodNumber: typeof body.periodNumber === 'number' ? body.periodNumber : undefined,
    });

    res.status(201).json({ data: unwrap(result) });
  })
);

// ─── Report Lifecycle ───────────────────────────────────────────────────

taxReportingRouter.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const result = await automatedReportService.listReports({
      tenantId: typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined,
      merchantId: typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined,
      period: typeof req.query.period === 'string' ? req.query.period as ReportPeriod : undefined,
      year: req.query.year ? Number(req.query.year) : undefined,
      status: typeof req.query.status === 'string' ? req.query.status as any : undefined,
      reportType: typeof req.query.reportType === 'string' ? req.query.reportType as any : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.get(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await automatedReportService.getReport(id);
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.post(
  '/reports/:id/finalize',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await automatedReportService.finalizeReport(id);
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.post(
  '/reports/:id/archive',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await automatedReportService.archiveReport(id);
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.get(
  '/reports/:id/export',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const format = parseExportFormat(req.query.format);

    const reportResult = await automatedReportService.getReport(id);
    const report = unwrap(reportResult);

    const exportResult = exportService.exportTaxReport(report, { format });
    const exported = unwrap(exportResult);

    res.setHeader('Content-Type', exported.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.send(exported.content);
  })
);

// ─── Filing Report ──────────────────────────────────────────────────────

taxReportingRouter.post(
  '/filing',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const merchantId = requireMerchantId(req);
    const body = req.body as Record<string, unknown>;
    const year = typeof body.year === 'number' ? body.year : parseYear(req);

    const result = await automatedReportService.generateFilingReport({
      tenantId,
      merchantId,
      year,
      reportingCurrency: typeof body.reportingCurrency === 'string' ? body.reportingCurrency : undefined,
    });
    res.status(201).json({ data: unwrap(result) });
  })
);

taxReportingRouter.get(
  '/filing/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await automatedReportService.getFilingReport(id);
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.get(
  '/filing/:id/export',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const format = parseExportFormat(req.query.format);

    const filingResult = await automatedReportService.getFilingReport(id);
    const filing = unwrap(filingResult);

    const exportResult = exportService.exportFilingReport(filing, { format });
    const exported = unwrap(exportResult);

    res.setHeader('Content-Type', exported.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.send(exported.content);
  })
);

// ─── Calendar: Deadlines ────────────────────────────────────────────────

taxReportingRouter.post(
  '/calendar/deadlines',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const merchantId = requireMerchantId(req);
    const body = req.body as Record<string, unknown>;

    if (typeof body.jurisdiction !== 'string' || body.jurisdiction.length === 0) {
      throw new AppError(400, 'jurisdiction is required', 'VALIDATION_ERROR');
    }
    if (typeof body.name !== 'string' || body.name.length === 0) {
      throw new AppError(400, 'name is required', 'VALIDATION_ERROR');
    }

    const dueDate = parseDate(body.dueDate, 'dueDate');
    if (!dueDate) {
      throw new AppError(400, 'dueDate is required', 'VALIDATION_ERROR');
    }

    const result = await calendarService.createDeadline({
      tenantId,
      merchantId,
      jurisdiction: body.jurisdiction as string,
      name: body.name as string,
      description: typeof body.description === 'string' ? body.description : undefined,
      frequency: parseFrequency(body.frequency),
      dueDate,
      dueSoonThresholdDays: typeof body.dueSoonThresholdDays === 'number' ? body.dueSoonThresholdDays : undefined,
      metadata: (body.metadata as Record<string, unknown> | undefined) ?? undefined,
    });

    res.status(201).json({ data: unwrap(result) });
  })
);

taxReportingRouter.get(
  '/calendar/deadlines',
  asyncHandler(async (req, res) => {
    const result = await calendarService.listDeadlines({
      tenantId: typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined,
      merchantId: typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined,
      jurisdiction: typeof req.query.jurisdiction === 'string' ? req.query.jurisdiction : undefined,
      status: typeof req.query.status === 'string' ? req.query.status as any : undefined,
      frequency: typeof req.query.frequency === 'string' ? req.query.frequency as any : undefined,
      dueBefore: parseDate(req.query.dueBefore, 'dueBefore'),
      dueAfter: parseDate(req.query.dueAfter, 'dueAfter'),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.get(
  '/calendar/deadlines/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await calendarService.getDeadline(id);
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.patch(
  '/calendar/deadlines/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = req.body as Record<string, unknown>;

    const result = await calendarService.updateDeadline(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      frequency: typeof body.frequency === 'string' ? body.frequency as DeadlineFrequency : undefined,
      dueDate: parseDate(body.dueDate, 'dueDate'),
      status: typeof body.status === 'string' ? body.status as any : undefined,
      dueSoonThresholdDays: typeof body.dueSoonThresholdDays === 'number' ? body.dueSoonThresholdDays : undefined,
      extensionUntil: body.extensionUntil === null ? null : parseDate(body.extensionUntil, 'extensionUntil'),
      metadata: body.metadata === null ? null : (body.metadata as Record<string, unknown> | undefined),
    });
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.post(
  '/calendar/deadlines/:id/complete',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await calendarService.completeDeadline(id);
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.post(
  '/calendar/deadlines/:id/extend',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = req.body as Record<string, unknown>;
    const extensionUntil = parseDate(body.extensionUntil, 'extensionUntil');
    if (!extensionUntil) {
      throw new AppError(400, 'extensionUntil is required', 'VALIDATION_ERROR');
    }
    const result = await calendarService.extendDeadline(id, extensionUntil);
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.delete(
  '/calendar/deadlines/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await calendarService.deleteDeadline(id);
    if (!result.ok) {
      const err = result as { ok: false; error: { statusCode: number; message: string; code: string } };
      throw new AppError(err.error.statusCode, err.error.message, err.error.code);
    }
    res.status(204).send();
  })
);

// ─── Calendar: Alerts ───────────────────────────────────────────────────

taxReportingRouter.get(
  '/calendar/alerts',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    const lookaheadDays = req.query.lookaheadDays ? Number(req.query.lookaheadDays) : undefined;

    const result = await calendarService.getUpcomingAlerts({ tenantId, merchantId, lookaheadDays });
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.get(
  '/calendar/overdue',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;

    const result = await calendarService.getOverdueDeadlines({ tenantId, merchantId });
    res.json({ data: unwrap(result) });
  })
);

taxReportingRouter.get(
  '/calendar/templates',
  asyncHandler(async (req, res) => {
    const jurisdiction = typeof req.query.jurisdiction === 'string' ? req.query.jurisdiction : undefined;
    const templates = calendarService.getDefaultTemplates(jurisdiction);
    res.json({ data: templates });
  })
);

taxReportingRouter.post(
  '/calendar/templates/apply',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const merchantId = requireMerchantId(req);
    const body = req.body as Record<string, unknown>;

    if (typeof body.jurisdiction !== 'string' || body.jurisdiction.length === 0) {
      throw new AppError(400, 'jurisdiction is required', 'VALIDATION_ERROR');
    }
    if (typeof body.year !== 'number') {
      throw new AppError(400, 'year is required', 'VALIDATION_ERROR');
    }
    if (typeof body.periodNumber !== 'number') {
      throw new AppError(400, 'periodNumber is required', 'VALIDATION_ERROR');
    }

    const templates = calendarService.getDefaultTemplates(body.jurisdiction as string);
    const template = templates[0];
    if (!template) {
      throw new AppError(404, `No default template found for jurisdiction ${body.jurisdiction}`, 'NOT_FOUND');
    }

    const result = await calendarService.createDeadlineFromTemplate({
      tenantId,
      merchantId,
      template,
      year: body.year as number,
      periodNumber: body.periodNumber as number,
    });

    res.status(201).json({ data: unwrap(result) });
  })
);
