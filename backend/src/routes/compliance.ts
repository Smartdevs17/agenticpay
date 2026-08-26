/**
 * compliance.ts (routes) — Automated Compliance System
 *
 * Real-time compliance dashboard API with automation:
 * - GET  /compliance/metrics         → real-time metrics
 * - GET  /compliance/dashboard       → dashboard summary (legacy)
 * - GET  /compliance/automation/dashboard → full automated dashboard (acceptance criteria)
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
 *
 * NEW — Automated compliance:
 * - POST /compliance/checks/run      → run automated checks
 * - GET  /compliance/checks          → list check definitions
 * - GET  /compliance/checks/history  → history of runs
 * - GET  /compliance/checks/latest   → latest run
 * - POST /compliance/automation/run  → run full automation cycle
 * - POST /compliance/automation/checks → run automated checks only
 * - GET  /compliance/automation/dashboard (full)
 * - GET  /compliance/automation/tasks
 * - GET  /compliance/automation/metrics
 * - GET  /compliance/score           → compliance scoring
 *
 * NEW — Regulatory monitoring:
 * - GET  /compliance/regulatory/sources
 * - GET  /compliance/regulatory/updates
 * - GET  /compliance/regulatory/updates/:id
 * - POST /compliance/regulatory/updates
 * - PUT  /compliance/regulatory/updates/:id/status
 * - POST /compliance/regulatory/poll
 * - GET  /compliance/regulatory/metrics
 * - GET  /compliance/regulatory/deadlines
 * - GET  /compliance/documentation   → compliance docs overview
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { runComplianceChecks } from '../compliance/checks.js';
import { auditService } from '../services/auditService.js';
import { ComplianceService, JurisdictionCode, ComplianceMetricType, ComplianceAlertStatus } from '../services/complianceService.js';
import { ComplianceAutomationService } from '../services/compliance-automation.js';
import { RegulatoryMonitorService } from '../services/regulatory-monitor.js';
import {
  runAutomatedComplianceChecks,
  getCheckDefinitions,
  getComplianceHistory,
  getLatestRun,
} from '../compliance/engine.js';

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

// ─── Full Automated Dashboard (Acceptance Criteria: Compliance dashboard) ───

complianceRouter.get(
  '/automation/dashboard',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = (req.query.jurisdiction as JurisdictionCode) || undefined;
    const dashboard = ComplianceAutomationService.getDashboard(jurisdiction);

    res.status(200).json({
      success: true,
      data: dashboard,
    });
  }),
);

complianceRouter.get(
  '/automation/tasks',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit || '20')), 100);
    const tasks = ComplianceAutomationService.getTaskHistory(limit);
    res.status(200).json({ success: true, data: tasks, count: tasks.length });
  }),
);

complianceRouter.get(
  '/automation/metrics',
  asyncHandler(async (_req: Request, res: Response) => {
    const metrics = ComplianceAutomationService.getAutomationMetrics();
    const score = ComplianceService.calculateComplianceScore('GLOBAL');
    res.status(200).json({ success: true, data: { automation: metrics, complianceScore: score } });
  }),
);

complianceRouter.post(
  '/automation/run',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = (req.body.jurisdiction as JurisdictionCode) || 'GLOBAL';
    const result = await ComplianceAutomationService.runFullCycle(jurisdiction, 'manual');
    res.status(200).json({ success: true, data: result, message: 'Full compliance automation cycle completed' });
  }),
);

complianceRouter.post(
  '/automation/checks',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = (req.body.jurisdiction as JurisdictionCode) || 'GLOBAL';
    const category = req.body.category;
    const { summary, task } = await ComplianceAutomationService.runAutomatedChecks(jurisdiction, category, 'manual');
    res.status(200).json({ success: true, data: { summary, task } });
  }),
);

// ─── Compliance Score ─────────────────────────────────────────────────────────

complianceRouter.get(
  '/score',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = (req.query.jurisdiction as JurisdictionCode) || 'GLOBAL';
    const score = ComplianceService.calculateComplianceScore(jurisdiction);
    res.status(200).json({ success: true, data: score, jurisdiction });
  }),
);

// ─── Automated Compliance Checks ─────────────────────────────────────────────

complianceRouter.get(
  '/checks',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = req.query.jurisdiction as string | undefined;
    const category = req.query.category as any | undefined;
    const checks = getCheckDefinitions(jurisdiction, category);
    res.status(200).json({
      success: true,
      data: checks.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        category: c.category,
        severity: c.severity,
        jurisdiction: c.jurisdiction,
        remediation: c.remediation,
        regulatoryRef: c.regulatoryRef,
      })),
      count: checks.length,
    });
  }),
);

complianceRouter.post(
  '/checks/run',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = (req.body.jurisdiction as string) || 'GLOBAL';
    const category = req.body.category;
    const summary = await runAutomatedComplianceChecks(jurisdiction, category);
    res.status(200).json({ success: true, data: summary });
  }),
);

complianceRouter.get(
  '/checks/history',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit || '20')), 100);
    const history = getComplianceHistory(limit);
    res.status(200).json({ success: true, data: history, count: history.length });
  }),
);

complianceRouter.get(
  '/checks/latest',
  asyncHandler(async (_req: Request, res: Response) => {
    const latest = getLatestRun();
    if (!latest) {
      return res.status(404).json({ success: false, error: { message: 'No compliance runs yet' } });
    }
    res.status(200).json({ success: true, data: latest });
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
    const jurisdiction = String(req.params.jurisdiction);
    const metric = String(req.params.metric);
    const { warningLevel, criticalLevel } = req.body;

    const updated = ComplianceService.updateThreshold(
      jurisdiction as JurisdictionCode,
      metric as ComplianceMetricType,
      { warningLevel, criticalLevel },
      String(req.body.updatedBy || 'system'),
    );

    res.status(200).json({ success: true, data: updated });
  }),
);

complianceRouter.post(
  '/thresholds',
  asyncHandler(async (req: Request, res: Response) => {
    const { metric, warningLevel, criticalLevel, jurisdiction, description, regulatoryRef } = req.body;
    if (!metric || warningLevel === undefined || criticalLevel === undefined || !jurisdiction) {
      return res
        .status(400)
        .json({ success: false, error: { message: 'metric, warningLevel, criticalLevel, jurisdiction required' } });
    }
    const created = ComplianceService.createThreshold(
      {
        metric,
        warningLevel,
        criticalLevel,
        jurisdiction,
        description: description || `${metric} threshold`,
        regulatoryRef,
      },
      String(req.body.createdBy || 'system'),
    );
    res.status(201).json({ success: true, data: created });
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

complianceRouter.get(
  '/alerts/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const alert = ComplianceService.getAlertById(String(req.params.id));
    if (!alert) return res.status(404).json({ success: false, error: { message: 'Alert not found' } });
    res.status(200).json({ success: true, data: alert });
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
    const id = String(req.params.id);
    const userId = String(req.body.userId || 'system');
    const alert = ComplianceService.acknowledgeAlert(id, userId);
    res.status(200).json({ success: true, data: alert });
  }),
);

complianceRouter.post(
  '/alerts/:id/resolve',
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const userId = String(req.body.userId || 'system');
    const alert = ComplianceService.resolveAlert(id, userId);
    res.status(200).json({ success: true, data: alert });
  }),
);

complianceRouter.post(
  '/alerts/bulk/resolve',
  asyncHandler(async (req: Request, res: Response) => {
    const { ids, userId = 'system' } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: { message: 'ids array required' } });
    }
    const resolved = ComplianceService.bulkResolveAlerts(ids, String(userId));
    res.status(200).json({ success: true, data: resolved, count: resolved.length });
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
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = req.query.jurisdiction as JurisdictionCode | undefined;
    const reportList = ComplianceService.listReports(jurisdiction);
    res.status(200).json({ success: true, data: reportList, count: reportList.length });
  }),
);

complianceRouter.get(
  '/reports/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const report = ComplianceService.getReport(String(req.params.id));
    if (!report) return res.status(404).json({ success: false, error: { message: 'Report not found' } });
    res.status(200).json({ success: true, data: report });
  }),
);

complianceRouter.get(
  '/reports/:id/export',
  asyncHandler(async (req: Request, res: Response) => {
    const report = ComplianceService.getReport(String(req.params.id));
    if (!report) return res.status(404).json({ success: false, error: { message: 'Report not found' } });

    const json = ComplianceService.exportReportAsJSON(String(req.params.id));
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

complianceRouter.get(
  '/audit/csv',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = req.query.jurisdiction as JurisdictionCode | undefined;
    const limit = Math.min(parseInt(String(req.query.limit || '500')), 1000);
    const csv = ComplianceService.exportAuditTrailAsCSV(jurisdiction, limit);
    const filename = `compliance-audit-${jurisdiction || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
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

// ─── Regulatory Monitoring (Acceptance Criteria: Regulatory update monitoring) ──

complianceRouter.get(
  '/regulatory/sources',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = req.query.jurisdiction as any | undefined;
    const sources = RegulatoryMonitorService.getSources(jurisdiction);
    res.status(200).json({ success: true, data: sources, count: sources.length });
  }),
);

complianceRouter.get(
  '/regulatory/updates',
  asyncHandler(async (req: Request, res: Response) => {
    const jurisdiction = req.query.jurisdiction as any | undefined;
    const status = req.query.status as any | undefined;
    const impactLevel = req.query.impactLevel as any | undefined;
    const category = req.query.category as string | undefined;
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);

    const updates = RegulatoryMonitorService.getUpdates({
      jurisdiction,
      status,
      impactLevel,
      category,
      limit,
    });
    res.status(200).json({ success: true, data: updates, count: updates.length });
  }),
);

complianceRouter.get(
  '/regulatory/updates/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const update = RegulatoryMonitorService.getUpdateById(String(req.params.id));
    if (!update) return res.status(404).json({ success: false, error: { message: 'Regulatory update not found' } });
    res.status(200).json({ success: true, data: update });
  }),
);

complianceRouter.post(
  '/regulatory/updates',
  asyncHandler(async (req: Request, res: Response) => {
    const { sourceId, sourceName, jurisdiction, title, summary, impactLevel, categories, requiredActions } = req.body;
    if (!title || !jurisdiction) {
      return res.status(400).json({ success: false, error: { message: 'title and jurisdiction required' } });
    }
    const created = RegulatoryMonitorService.addUpdate({
      sourceId: sourceId || 'manual',
      sourceName: sourceName || 'Manual Entry',
      jurisdiction: jurisdiction as any,
      title,
      summary: summary || title,
      impactLevel: impactLevel || 'medium',
      status: 'new',
      categories: categories || ['general'],
      publishedAt: new Date().toISOString(),
      requiredActions: requiredActions || [],
      relatedRegulations: req.body.relatedRegulations || [],
      riskScore: req.body.riskScore || 50,
      url: req.body.url,
      fullContent: req.body.fullContent,
      effectiveDate: req.body.effectiveDate,
      complianceDeadline: req.body.complianceDeadline,
    } as any);
    res.status(201).json({ success: true, data: created });
  }),
);

complianceRouter.put(
  '/regulatory/updates/:id/status',
  asyncHandler(async (req: Request, res: Response) => {
    const { status, notes, reviewedBy } = req.body;
    if (!status) return res.status(400).json({ success: false, error: { message: 'status required' } });
    try {
      const updated = RegulatoryMonitorService.updateStatus(String(req.params.id), status, notes, reviewedBy);
      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      return res.status(404).json({ success: false, error: { message: (err as Error).message } });
    }
  }),
);

complianceRouter.post(
  '/regulatory/poll',
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await ComplianceAutomationService.pollRegulatoryUpdates('manual');
    res.status(200).json({ success: true, data: result.result, task: result.task });
  }),
);

complianceRouter.get(
  '/regulatory/metrics',
  asyncHandler(async (_req: Request, res: Response) => {
    const metrics = RegulatoryMonitorService.getMetrics();
    res.status(200).json({ success: true, data: metrics });
  }),
);

complianceRouter.get(
  '/regulatory/deadlines',
  asyncHandler(async (req: Request, res: Response) => {
    const days = Math.min(parseInt(String(req.query.days || '60')), 365);
    const deadlines = RegulatoryMonitorService.getUpcomingDeadlines(days);
    res.status(200).json({ success: true, data: deadlines, count: deadlines.length });
  }),
);

// ─── Documentation ───────────────────────────────────────────────────────────

complianceRouter.get(
  '/documentation',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        overview:
          'AgenticPay Automated Compliance System provides real-time compliance monitoring, automated checks, regulatory update tracking, reporting, alerts, audit trail, and dashboard.',
        features: [
          'Automated compliance checks — 15+ checks across KYC, AML, sanctions, data protection, security, transaction monitoring, reporting, operational',
          'Regulatory update monitoring — 8 sources across US, EU, UK, SG, AU, GLOBAL; automated polling, impact assessment, deadlines',
          'Compliance reporting — on-demand and scheduled monthly reports per jurisdiction with export',
          'Compliance alerts — threshold-based + check-based, multi-severity, acknowledgment/resolution workflow',
          'Compliance audit trail — immutable logging of all compliance actions, CSV export',
          'Compliance dashboard — aggregated view with scores, metrics, jurisdictions, alerts, regulatory updates, automation history',
          'Compliance documentation — comprehensive guide at backend/docs/COMPLIANCE_GUIDE.md',
        ],
        automation: {
          schedule: {
            hourly: 'Threshold evaluation',
            daily: 'Full compliance check run',
            daily_regulatory: 'Regulatory source polling (every 6 hours for critical sources like OFAC)',
            monthly: 'Compliance report generation per jurisdiction',
          },
          endpoints: {
            runChecks: 'POST /api/v1/compliance/checks/run',
            automationRun: 'POST /api/v1/compliance/automation/run',
            dashboard: 'GET /api/v1/compliance/automation/dashboard',
          },
        },
        regulatorySources: RegulatoryMonitorService.getSources().map((s) => ({
          id: s.id,
          name: s.name,
          jurisdiction: s.jurisdiction,
          url: s.url,
        })),
        documentationUrl: '/docs/COMPLIANCE_GUIDE.md',
      },
    });
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
