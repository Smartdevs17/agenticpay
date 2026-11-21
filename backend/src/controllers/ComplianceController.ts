/**
 * ComplianceController.ts — Issue #597
 *
 * HTTP layer for compliance dashboard.
 * Handles request/response only — no business logic here.
 */

import { Request, Response, NextFunction } from 'express';
import { BaseController } from './BaseController.js';
import { ComplianceService, JurisdictionCode, ComplianceMetricType, ComplianceAlertStatus } from '../services/complianceService.js';

export class ComplianceController extends BaseController {
  constructor(private readonly complianceService: typeof ComplianceService) {
    super();
  }

  getDashboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const jurisdiction = req.query.jurisdiction as JurisdictionCode | undefined;
      const metrics = this.complianceService.getDashboardMetrics(jurisdiction);
      const jurisdictionStatus = this.complianceService.getJurisdictionStatus();
      const openAlerts = this.complianceService.getAlerts('open');

      res.status(200).json({
        success: true,
        data: { metrics, jurisdictionStatus, openAlerts: openAlerts.slice(0, 10), generatedAt: new Date().toISOString() },
      });
    });
  };

  getMetrics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const jurisdiction = (req.query.jurisdiction as JurisdictionCode) || 'GLOBAL';
      const complianceMetrics = this.complianceService.getMetrics(jurisdiction);
      res.status(200).json({ success: true, data: complianceMetrics, jurisdiction });
    });
  };

  getJurisdictions = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(_req, res, next, async (_req, res) => {
      const jurisdictionStatus = this.complianceService.getJurisdictionStatus();
      res.status(200).json({ success: true, data: jurisdictionStatus });
    });
  };

  getThresholds = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const jurisdiction = req.query.jurisdiction as JurisdictionCode | undefined;
      const thresholds = this.complianceService.getThresholds(jurisdiction);
      res.status(200).json({ success: true, data: thresholds });
    });
  };

  updateThreshold = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const { jurisdiction, metric } = req.params;
      const { warningLevel, criticalLevel } = req.body;
      const updated = this.complianceService.updateThreshold(
        jurisdiction as JurisdictionCode,
        metric as ComplianceMetricType,
        { warningLevel, criticalLevel },
      );
      res.status(200).json({ success: true, data: updated });
    });
  };

  getAlerts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const status = req.query.status as ComplianceAlertStatus | undefined;
      const jurisdiction = req.query.jurisdiction as JurisdictionCode | undefined;
      const alertList = this.complianceService.getAlerts(status, jurisdiction);
      res.status(200).json({ success: true, data: alertList, count: alertList.length });
    });
  };

  evaluateThresholds = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(_req, res, next, async (_req, res) => {
      const newAlerts = this.complianceService.evaluateThresholds();
      res.status(200).json({
        success: true,
        data: newAlerts,
        count: newAlerts.length,
        message: `Evaluation complete. ${newAlerts.length} new alert(s) raised.`,
      });
    });
  };

  acknowledgeAlert = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const userId = String(req.body.userId || 'system');
      const alert = this.complianceService.acknowledgeAlert(String(String(req.params.id)), userId);
      res.status(200).json({ success: true, data: alert });
    });
  };

  resolveAlert = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const userId = String(req.body.userId || 'system');
      const alert = this.complianceService.resolveAlert(String(String(req.params.id)), userId);
      res.status(200).json({ success: true, data: alert });
    });
  };

  requestReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const { period, jurisdiction = 'GLOBAL' } = req.body;
      if (!period) {
        res.status(400).json({ success: false, error: { message: 'period is required (e.g. 2026-01)' } });
        return;
      }
      const report = await this.complianceService.requestReport(period, jurisdiction as JurisdictionCode);
      res.status(202).json({ success: true, data: report });
    });
  };

  listReports = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(_req, res, next, async (_req, res) => {
      const reportList = this.complianceService.listReports();
      res.status(200).json({ success: true, data: reportList, count: reportList.length });
    });
  };

  getReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const report = this.complianceService.getReport(String(req.params.id));
      if (!report) {
        res.status(404).json({ success: false, error: { message: 'Report not found' } });
        return;
      }
      res.status(200).json({ success: true, data: report });
    });
  };

  exportReportJSON = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const report = this.complianceService.getReport(String(req.params.id));
      if (!report) {
        res.status(404).json({ success: false, error: { message: 'Report not found' } });
        return;
      }
      const json = this.complianceService.exportReportAsJSON(String(req.params.id));
      const filename = `compliance-report-${report.jurisdiction}-${report.period}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(json);
    });
  };

  exportCSV = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const jurisdiction = (req.query.jurisdiction as JurisdictionCode) || 'GLOBAL';
      const csv = this.complianceService.exportMetricsAsCSV(jurisdiction);
      const filename = `compliance-metrics-${jurisdiction}-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    });
  };

  getAuditTrail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const entityType = req.query.entityType as string | undefined;
      const jurisdiction = req.query.jurisdiction as JurisdictionCode | undefined;
      const limit = Math.min(parseInt(String(req.query.limit || '100')), 500);
      const entries = this.complianceService.getAuditTrail(entityType, jurisdiction, limit);
      res.status(200).json({ success: true, data: entries, count: entries.length });
    });
  };
}
