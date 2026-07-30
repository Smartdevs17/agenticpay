/**
 * compliance.ts (routes) — Issue #590
 *
 * Real-time compliance dashboard API:
 * - GET  /compliance/metrics         → real-time metrics
 * - GET  /compliance/dashboard       → dashboard summary
 * - GET  /compliance/thresholds      → list thresholds
 * - PUT  /compliance/thresholds/:jurisdiction/:metric → update threshold
 * - GET  /compliance/alerts          → list alerts
 * - POST /compliance/alerts/evaluate → trigger evaluation
 * - POST /compliance/alerts/:id/acknowledge
 * - POST /compliance/alerts/:id/resolve
 * - GET  /compliance/jurisdictions   → per-jurisdiction status
 * - POST /compliance/reports         → request new report
 * - GET  /compliance/reports         → list reports
 * - GET  /compliance/reports/:id     → get report
 * - GET  /compliance/reports/:id/export → export report
 * - GET  /compliance/audit           → audit trail
 * - GET  /compliance/export/csv      → CSV export
 * - GET  /compliance/status (legacy) → basic checks
 * - GET  /compliance/evidence/audit/export (legacy)
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { runComplianceChecks } from '../compliance/checks.js';
import { auditService } from '../services/auditService.js';
import { ComplianceService, JurisdictionCode, ComplianceMetricType, ComplianceAlertStatus } from '../services/complianceService.js';

export const complianceRouter = Router();

// ─── Dashboard ───────────────────────────────────────────────────────────────

complianceRouter.get(
  '/dashboard',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = (req.query.jurisdiction as JurisdictionCode) || undefined;
    const metrics = ComplianceService.getDashboardMetrics(jurisdiction);
    const jurisdictionStatus = ComplianceService.getJurisdictionStatus();
    const openAlerts = ComplianceService.getAlerts('open');

    res.status(200).json({
      success: true,
      data: {
        metrics,
        jurisdictionStatus,
        openAlerts: openAlerts.slice(0, 10),
        generatedAt: new Date().toISOString(),
      },
    });
  }),
);

// ─── Real-time metrics ────────────────────────────────────────────────────────

complianceRouter.get(
  '/metrics',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = (req.query.jurisdiction as JurisdictionCode) || 'GLOBAL';
    const complianceMetrics = ComplianceService.getMetrics(jurisdiction);

    res.status(200).json({
      success: true,
      data: complianceMetrics,
      jurisdiction,
    });
  }),
);

// ─── Jurisdictions ────────────────────────────────────────────────────────────

complianceRouter.get(
  '/jurisdictions',
  asyncHandler(async (_req: Request, res: Response) => {
    const jurisdictionStatus = ComplianceService.getJurisdictionStatus();
    res.status(200).json({ success: true, data: jurisdictionStatus });
  }),
);

// ─── Thresholds ───────────────────────────────────────────────────────────────

complianceRouter.get(
  '/thresholds',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = req.query.jurisdiction as JurisdictionCode | undefined;
    const thresholds = ComplianceService.getThresholds(jurisdiction);
    res.status(200).json({ success: true, data: thresholds });
  }),
);

complianceRouter.put(
  '/thresholds/:jurisdiction/:metric',
  asyncHandler(async (req: Request, res: Response) => {
    const { jurisdiction, metric } = req.params;
    const { warningLevel, criticalLevel } = req.body;

    const updated = ComplianceService.updateThreshold(
      jurisdiction as JurisdictionCode,
      metric as ComplianceMetricType,
      { warningLevel, criticalLevel },
    );

    res.status(200).json({ success: true, data: updated });
  }),
);

// ─── Alerts ───────────────────────────────────────────────────────────────────

complianceRouter.get(
  '/alerts',
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as ComplianceAlertStatus | undefined;
    const jurisdiction = req.query.jurisdiction as JurisdictionCode | undefined;
    const alertList = ComplianceService.getAlerts(status, jurisdiction);

    res.status(200).json({
      success: true,
      data: alertList,
      count: alertList.length,
    });
  }),
);

complianceRouter.post(
  '/alerts/evaluate',
  asyncHandler(async (_req: Request, res: Response) => {
    const newAlerts = ComplianceService.evaluateThresholds();
    res.status(200).json({
      success: true,
      data: newAlerts,
      count: newAlerts.length,
      message: `Threshold evaluation complete. ${newAlerts.length} new alert(s) raised.`,
    });
  }),
);

complianceRouter.post(
  '/alerts/:id/acknowledge',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = String(req.body.userId || 'system');
    const alert = ComplianceService.acknowledgeAlert(id, userId);
    res.status(200).json({ success: true, data: alert });
  }),
);

complianceRouter.post(
  '/alerts/:id/resolve',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = String(req.body.userId || 'system');
    const alert = ComplianceService.resolveAlert(id, userId);
    res.status(200).json({ success: true, data: alert });
  }),
);

// ─── Reports ──────────────────────────────────────────────────────────────────

complianceRouter.post(
  '/reports',
  asyncHandler(async (req: Request, res: Response) => {
    const { period, jurisdiction = 'GLOBAL' } = req.body;
    if (!period) {
      return res.status(400).json({ success: false, error: { message: 'period is required (e.g. 2026-01)' } });
    }

    const report = await ComplianceService.requestReport(period, jurisdiction as JurisdictionCode);
    res.status(202).json({
      success: true,
      data: report,
      message: 'Compliance report requested. Use GET /compliance/reports/:id to check status.',
    });
  }),
);

complianceRouter.get(
  '/reports',
  asyncHandler(async (_req: Request, res: Response) => {
    const reportList = ComplianceService.listReports();
    res.status(200).json({ success: true, data: reportList, count: reportList.length });
  }),
);

complianceRouter.get(
  '/reports/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const report = ComplianceService.getReport(req.params.id);
    if (!report) return res.status(404).json({ success: false, error: { message: 'Report not found' } });
    res.status(200).json({ success: true, data: report });
  }),
);

complianceRouter.get(
  '/reports/:id/export',
  asyncHandler(async (req: Request, res: Response) => {
    const report = ComplianceService.getReport(req.params.id);
    if (!report) return res.status(404).json({ success: false, error: { message: 'Report not found' } });

    const json = ComplianceService.exportReportAsJSON(req.params.id);
    const filename = `compliance-report-${report.jurisdiction}-${report.period}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(json);
  }),
);

// ─── Audit trail ─────────────────────────────────────────────────────────────

complianceRouter.get(
  '/audit',
  asyncHandler(async (req: Request, res: Response) => {
    const entityType = req.query.entityType as string | undefined;
    const jurisdiction = req.query.jurisdiction as JurisdictionCode | undefined;
    const limit = Math.min(parseInt(String(req.query.limit || '100')), 500);
    const entries = ComplianceService.getAuditTrail(entityType, jurisdiction, limit);

    res.status(200).json({ success: true, data: entries, count: entries.length });
  }),
);

// ─── CSV export ───────────────────────────────────────────────────────────────

complianceRouter.get(
  '/export/csv',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = (req.query.jurisdiction as JurisdictionCode) || 'GLOBAL';
    const csv = ComplianceService.exportMetricsAsCSV(jurisdiction);
    const filename = `compliance-metrics-${jurisdiction}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  }),
);

// ─── Legacy endpoints (maintained for backwards compatibility) ─────────────────

complianceRouter.get(
  '/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const checks = runComplianceChecks();
    res.status(200).json({ checks });
  }),
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
  }),
);
