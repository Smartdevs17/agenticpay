import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import {
  complianceService,
  type ComplianceAlert,
  type ComplianceCategory,
  type ComplianceSeverity,
  type RegulatoryUpdate,
} from '../compliance/service.js';
import { auditService } from '../services/auditService.js';

export const complianceRouter = Router();

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parseLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 250));
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(400, `${field} is required`, 'VALIDATION_ERROR');
  }
  return value.trim();
}

function parseRegulatoryUpdateStatus(value: unknown): RegulatoryUpdate['status'] | undefined {
  const status = optionalString(value);
  return status === 'new' || status === 'reviewing' || status === 'acknowledged' || status === 'implemented'
    ? status
    : undefined;
}

function parseAlertStatus(value: unknown): ComplianceAlert['status'] | undefined {
  const status = optionalString(value);
  return status === 'open' || status === 'acknowledged' || status === 'resolved' ? status : undefined;
}

complianceRouter.get(
  '/status',
  asyncHandler(async (req: Request, res: Response) => {
    const run = await complianceService.runAutomatedChecks({
      tenantId: optionalString(req.query.tenantId),
      source: 'api',
      emitAlerts: true,
    });
    res.status(200).json({
      runId: run.id,
      generatedAt: run.completedAt,
      summary: run.summary,
      checks: run.checks,
    });
  })
);

complianceRouter.get(
  '/checks',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = parseLimit(req.query.limit, 20);
    const latest = complianceService.getLatestRun();
    res.status(200).json({
      latest,
      runs: complianceService.listRuns(limit),
    });
  })
);

complianceRouter.post(
  '/checks/run',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const source = optionalString(body.source) as 'api' | 'scheduler' | 'manual' | 'test' | undefined;
    const run = await complianceService.runAutomatedChecks({
      tenantId: optionalString(body.tenantId),
      source: source ?? 'manual',
      emitAlerts: body.emitAlerts !== false,
    });
    res.status(201).json({ data: run });
  })
);

complianceRouter.get(
  '/regulatory-sources',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json({ data: complianceService.listRegulatorySources() });
  })
);

complianceRouter.get(
  '/regulatory-updates',
  asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json({
      data: complianceService.listRegulatoryUpdates({
        status: parseRegulatoryUpdateStatus(req.query.status),
        severity: optionalString(req.query.severity) as ComplianceSeverity | undefined,
        jurisdiction: optionalString(req.query.jurisdiction),
      }),
    });
  })
);

complianceRouter.post(
  '/regulatory-updates/monitor',
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await complianceService.monitorRegulatoryUpdates();
    res.status(200).json({ data: result });
  })
);

complianceRouter.post(
  '/regulatory-updates/ingest',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const update = await complianceService.ingestRegulatoryUpdate({
      sourceId: optionalString(body.sourceId),
      sourceName: optionalString(body.sourceName),
      title: requireString(body, 'title'),
      url: optionalString(body.url),
      summary: requireString(body, 'summary'),
      jurisdiction: optionalString(body.jurisdiction),
      category: optionalString(body.category) as ComplianceCategory | undefined,
      severity: optionalString(body.severity) as Exclude<ComplianceSeverity, 'info'> | undefined,
      publishedAt: optionalString(body.publishedAt),
      tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    });
    res.status(201).json({ data: update });
  })
);

complianceRouter.get(
  '/reports',
  asyncHandler(async (req: Request, res: Response) => {
    const report = await complianceService.generateReport({
      tenantId: optionalString(req.query.tenantId),
      from: optionalString(req.query.from),
      to: optionalString(req.query.to),
    });

    if (String(req.query.format || 'json').toLowerCase() === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.status(200).send(complianceService.reportToCsv(report));
      return;
    }

    res.status(200).json({ data: report });
  })
);

complianceRouter.get(
  '/alerts',
  asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json({
      data: complianceService.listAlerts({
        status: parseAlertStatus(req.query.status),
        severity: optionalString(req.query.severity) as ComplianceSeverity | undefined,
      }),
    });
  })
);

complianceRouter.post(
  '/alerts/:id/acknowledge',
  asyncHandler(async (req: Request, res: Response) => {
    const alert = await complianceService.acknowledgeAlert(String(req.params.id), optionalString(req.body?.actor) ?? 'system');
    if (!alert) throw new AppError(404, 'Compliance alert not found', 'NOT_FOUND');
    res.status(200).json({ data: alert });
  })
);

complianceRouter.post(
  '/alerts/:id/resolve',
  asyncHandler(async (req: Request, res: Response) => {
    const alert = await complianceService.resolveAlert(String(req.params.id), optionalString(req.body?.actor) ?? 'system');
    if (!alert) throw new AppError(404, 'Compliance alert not found', 'NOT_FOUND');
    res.status(200).json({ data: alert });
  })
);

complianceRouter.get(
  '/audit-trail',
  asyncHandler(async (req: Request, res: Response) => {
    const trail = await complianceService.getAuditTrail({
      startDate: optionalString(req.query.from),
      endDate: optionalString(req.query.to),
      limit: parseLimit(req.query.limit),
      offset: Number(req.query.offset ?? 0),
    });
    res.status(200).json({ data: trail });
  })
);

complianceRouter.get(
  '/dashboard',
  asyncHandler(async (_req: Request, res: Response) => {
    const dashboard = await complianceService.getDashboard();
    res.status(200).json({ data: dashboard });
  })
);

complianceRouter.get(
  '/documentation',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json({ data: complianceService.getDocumentation() });
  })
);

complianceRouter.get(
  '/evidence/audit/export',
  asyncHandler(async (req: Request, res: Response) => {
    const format = String(req.query.format || 'json').toLowerCase();

    if (format === 'csv') {
      const csv = await auditService.exportToCSV();
      res.setHeader('Content-Type', 'text/csv');
      res.status(200).send(csv);
      return;
    }

    const json = await auditService.exportToJSON();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(json);
  })
);
