import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { runComplianceChecks } from '../compliance/checks.js';
import { auditService } from '../services/auditService.js';
import { ComplianceService, type JurisdictionCode } from '../services/complianceService.js';
import { ComplianceController } from '../controllers/ComplianceController.js';
import { logger } from '../utils/logger.js';

export const complianceRouter = Router();

/** Same shape as `observability/datadog.ts` `metrics`, so it can be passed in directly. */
export interface ComplianceExportMetrics {
  increment(metric: string, value: number, tags: Record<string, string>): void;
  timing(metric: string, value: number, tags: Record<string, string>): void;
}

const noopMetrics: ComplianceExportMetrics = { increment: () => {}, timing: () => {} };
let metrics: ComplianceExportMetrics = noopMetrics;

/** Route regulator export metrics to a backend such as StatsD. Pass null to disable. */
export function setComplianceExportMetrics(sink: ComplianceExportMetrics | null): void {
  metrics = sink ?? noopMetrics;
}

const controller = new ComplianceController(ComplianceService);

const JURISDICTIONS: readonly JurisdictionCode[] = ['US', 'EU', 'UK', 'SG', 'AU', 'GLOBAL'];
const EXPORT_FORMATS = ['json', 'csv'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

complianceRouter.get(
  '/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const checks = runComplianceChecks();
    res.status(200).json({ checks });
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

// ─── Dashboard (frontend/app/dashboard/compliance) ───────────────────────────

complianceRouter.get('/dashboard', controller.getDashboard);
complianceRouter.get('/metrics', controller.getMetrics);
complianceRouter.get('/jurisdictions', controller.getJurisdictions);
complianceRouter.get('/thresholds', controller.getThresholds);
complianceRouter.get('/alerts', controller.getAlerts);
complianceRouter.post('/alerts/evaluate', controller.evaluateThresholds);
complianceRouter.post('/alerts/:id/acknowledge', controller.acknowledgeAlert);
complianceRouter.post('/alerts/:id/resolve', controller.resolveAlert);
complianceRouter.get('/reports', controller.listReports);
complianceRouter.post('/reports', controller.requestReport);
complianceRouter.get('/reports/:id', controller.getReport);
complianceRouter.get('/reports/:id/export', controller.exportReportJSON);
complianceRouter.get('/export/csv', controller.exportCSV);
complianceRouter.get('/audit-trail', controller.getAuditTrail);

// ─── Real-time regulator export ──────────────────────────────────────────────

/**
 * Builds a point-in-time snapshot for a regulator from live state: dashboard
 * metrics, per-metric threshold status, jurisdiction status, open alerts and
 * the recent audit trail. Every export is itself written to the audit trail.
 */
complianceRouter.get(
  '/regulator/export',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = String(req.query.jurisdiction || 'GLOBAL').toUpperCase() as JurisdictionCode;
    const format = String(req.query.format || 'json').toLowerCase() as ExportFormat;
    const requestedBy = String(req.query.requestedBy || 'regulator-export');

    if (!JURISDICTIONS.includes(jurisdiction)) {
      res.status(400).json({ success: false, error: { message: `Unsupported jurisdiction: ${jurisdiction}` } });
      return;
    }
    if (!EXPORT_FORMATS.includes(format)) {
      res.status(400).json({ success: false, error: { message: `Unsupported format: ${format}. Use json or csv` } });
      return;
    }

    const started = Date.now();
    const generatedAt = new Date().toISOString();
    const scope = jurisdiction === 'GLOBAL' ? undefined : jurisdiction;
    const exportId = `regexp_${randomUUID().slice(0, 8)}`;
    const filename = `regulator-export-${jurisdiction}-${generatedAt.slice(0, 19).replace(/:/g, '')}.${format}`;

    let body: string;
    if (format === 'csv') {
      body = [
        `# AgenticPay regulator export ${exportId}`,
        `# jurisdiction=${jurisdiction} generatedAt=${generatedAt}`,
        '',
        '# metrics',
        ComplianceService.exportMetricsAsCSV(jurisdiction),
        '',
        '# audit_trail',
        ComplianceService.exportAuditTrailAsCSV(scope),
      ].join('\n');
    } else {
      body = JSON.stringify(
        {
          exportId,
          jurisdiction,
          generatedAt,
          dashboard: ComplianceService.getDashboardMetrics(scope),
          metrics: ComplianceService.getMetrics(jurisdiction),
          jurisdictions: ComplianceService.getJurisdictionStatus().filter(
            (j) => !scope || j.jurisdiction === scope,
          ),
          openAlerts: ComplianceService.getAlerts('open', scope),
          auditTrail: ComplianceService.getAuditTrail(undefined, scope, 500),
        },
        null,
        2,
      );
    }

    ComplianceService.addAuditEntry(
      'regulator_export',
      'compliance_export',
      exportId,
      requestedBy,
      jurisdiction,
      { format, bytes: Buffer.byteLength(body) },
      req.ip,
      false,
    );

    const tags = { jurisdiction, format };
    metrics.increment('compliance.regulator_export', 1, tags);
    metrics.timing('compliance.regulator_export.duration', Date.now() - started, tags);
    logger.info('[compliance] regulator export generated', { exportId, jurisdiction, format });

    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(body);
  })
);
