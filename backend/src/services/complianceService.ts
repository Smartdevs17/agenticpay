/**
 * ComplianceService.ts — Issue #590
 *
 * Real-time regulatory compliance monitoring service.
 * Provides KYC/AML threshold monitoring, multi-jurisdiction tracking,
 * alert generation, and audit-trail exports.
 */

import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type JurisdictionCode = 'US' | 'EU' | 'UK' | 'SG' | 'AU' | 'GLOBAL';
export type ComplianceAlertSeverity = 'info' | 'warning' | 'critical';
export type ComplianceAlertStatus = 'open' | 'acknowledged' | 'resolved';
export type ComplianceMetricType = 'kyc_verification_rate' | 'aml_flag_rate' | 'transaction_volume' | 'high_risk_ratio' | 'pep_hit_rate' | 'sanctions_hit_rate';
export type ReportStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface ComplianceThreshold {
  metric: ComplianceMetricType;
  warningLevel: number;
  criticalLevel: number;
  jurisdiction: JurisdictionCode;
  description: string;
}

export interface ComplianceMetric {
  metric: ComplianceMetricType;
  value: number;
  previousValue: number;
  changePercent: number;
  jurisdiction: JurisdictionCode;
  timestamp: string;
  status: 'pass' | 'warn' | 'critical';
}

export interface ComplianceAlert {
  id: string;
  type: ComplianceMetricType;
  severity: ComplianceAlertSeverity;
  status: ComplianceAlertStatus;
  message: string;
  details: Record<string, unknown>;
  jurisdiction: JurisdictionCode;
  triggeredAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  acknowledgedBy?: string;
}

export interface JurisdictionStatus {
  jurisdiction: JurisdictionCode;
  overallStatus: 'compliant' | 'review_required' | 'non_compliant';
  kycComplianceRate: number;
  amlFlagRate: number;
  transactionVolume: number;
  highRiskCount: number;
  lastChecked: string;
}

export interface ComplianceDashboardMetrics {
  totalUsers: number;
  verifiedUsers: number;
  kycVerificationRate: number;
  amlFlags: number;
  amlFlagRate: number;
  highRiskTransactions: number;
  sanctionsHits: number;
  pepHits: number;
  openAlerts: number;
  criticalAlerts: number;
  generatedAt: string;
}

export interface ComplianceReport {
  id: string;
  period: string;
  jurisdiction: JurisdictionCode;
  status: ReportStatus;
  metrics: ComplianceDashboardMetrics;
  jurisdictionBreakdown: JurisdictionStatus[];
  alerts: ComplianceAlert[];
  generatedAt?: string;
  requestedAt: string;
  exportUrl?: string;
}

export interface AuditTrailEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  jurisdiction: JurisdictionCode;
  details: Record<string, unknown>;
  timestamp: string;
  ipAddress?: string;
}

// ─── Default thresholds ───────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: ComplianceThreshold[] = [
  { metric: 'kyc_verification_rate', warningLevel: 85, criticalLevel: 70, jurisdiction: 'GLOBAL', description: 'KYC verification completion rate (%)' },
  { metric: 'aml_flag_rate', warningLevel: 2, criticalLevel: 5, jurisdiction: 'GLOBAL', description: 'AML flag rate per 1000 transactions (%)' },
  { metric: 'high_risk_ratio', warningLevel: 3, criticalLevel: 8, jurisdiction: 'GLOBAL', description: 'High-risk transaction ratio (%)' },
  { metric: 'pep_hit_rate', warningLevel: 0.5, criticalLevel: 1, jurisdiction: 'GLOBAL', description: 'Politically Exposed Person hit rate (%)' },
  { metric: 'sanctions_hit_rate', warningLevel: 0.1, criticalLevel: 0.5, jurisdiction: 'GLOBAL', description: 'Sanctions list hit rate (%)' },
  // US-specific
  { metric: 'kyc_verification_rate', warningLevel: 90, criticalLevel: 80, jurisdiction: 'US', description: 'US FinCEN KYC requirement compliance rate' },
  { metric: 'aml_flag_rate', warningLevel: 1.5, criticalLevel: 3, jurisdiction: 'US', description: 'US BSA AML threshold' },
  // EU-specific (AMLD6)
  { metric: 'kyc_verification_rate', warningLevel: 88, criticalLevel: 75, jurisdiction: 'EU', description: 'EU AMLD6 KYC compliance rate' },
  { metric: 'high_risk_ratio', warningLevel: 2, criticalLevel: 5, jurisdiction: 'EU', description: 'EU AMLD6 high-risk transaction ratio' },
];

// ─── In-memory stores (replace with DB in production) ─────────────────────────

const alerts = new Map<string, ComplianceAlert>();
const reports = new Map<string, ComplianceReport>();
const auditTrail: AuditTrailEntry[] = [];
const thresholds = new Map<string, ComplianceThreshold>();

// Initialise with defaults
DEFAULT_THRESHOLDS.forEach((t) => {
  thresholds.set(`${t.jurisdiction}:${t.metric}`, t);
});

// ─── Service ──────────────────────────────────────────────────────────────────

export class ComplianceService {
  /**
   * Get real-time dashboard metrics.
   * In production these would be aggregated from DB / data-warehouse.
   */
  static getDashboardMetrics(jurisdiction?: JurisdictionCode): ComplianceDashboardMetrics {
    // Simulated realistic metrics — wire to real DB in production
    const base: ComplianceDashboardMetrics = {
      totalUsers: 12_450,
      verifiedUsers: 11_203,
      kycVerificationRate: 90.0,
      amlFlags: 143,
      amlFlagRate: 1.2,
      highRiskTransactions: 312,
      sanctionsHits: 4,
      pepHits: 11,
      openAlerts: alerts.size === 0 ? 2 : Array.from(alerts.values()).filter((a) => a.status === 'open').length,
      criticalAlerts: alerts.size === 0 ? 0 : Array.from(alerts.values()).filter((a) => a.severity === 'critical' && a.status === 'open').length,
      generatedAt: new Date().toISOString(),
    };

    // Apply jurisdiction-specific adjustments
    if (jurisdiction && jurisdiction !== 'GLOBAL') {
      base.totalUsers = Math.floor(base.totalUsers * 0.3);
      base.verifiedUsers = Math.floor(base.verifiedUsers * 0.3);
      base.kycVerificationRate = Number((base.verifiedUsers / base.totalUsers * 100).toFixed(2));
    }

    return base;
  }

  /**
   * Get real-time compliance metrics against thresholds.
   */
  static getMetrics(jurisdiction: JurisdictionCode = 'GLOBAL'): ComplianceMetric[] {
    const dashboard = this.getDashboardMetrics(jurisdiction);
    const now = new Date().toISOString();

    const rawMetrics: Array<{ metric: ComplianceMetricType; value: number; previous: number }> = [
      { metric: 'kyc_verification_rate', value: dashboard.kycVerificationRate, previous: 89.2 },
      { metric: 'aml_flag_rate', value: dashboard.amlFlagRate, previous: 1.0 },
      { metric: 'high_risk_ratio', value: (dashboard.highRiskTransactions / dashboard.totalUsers) * 100, previous: 2.1 },
      { metric: 'pep_hit_rate', value: (dashboard.pepHits / dashboard.totalUsers) * 100, previous: 0.08 },
      { metric: 'sanctions_hit_rate', value: (dashboard.sanctionsHits / dashboard.totalUsers) * 100, previous: 0.02 },
    ];

    return rawMetrics.map(({ metric, value, previous }) => {
      const threshold = thresholds.get(`${jurisdiction}:${metric}`) || thresholds.get(`GLOBAL:${metric}`);
      let status: 'pass' | 'warn' | 'critical' = 'pass';

      if (threshold) {
        // For rate metrics: lower is worse (kyc_verification_rate)
        if (metric === 'kyc_verification_rate') {
          if (value <= threshold.criticalLevel) status = 'critical';
          else if (value <= threshold.warningLevel) status = 'warn';
        } else {
          // For flag/risk metrics: higher is worse
          if (value >= threshold.criticalLevel) status = 'critical';
          else if (value >= threshold.warningLevel) status = 'warn';
        }
      }

      const changePercent = previous > 0 ? Number((((value - previous) / previous) * 100).toFixed(2)) : 0;

      return {
        metric,
        value: Number(value.toFixed(4)),
        previousValue: previous,
        changePercent,
        jurisdiction,
        timestamp: now,
        status,
      };
    });
  }

  /**
   * Get all compliance thresholds (optionally filtered by jurisdiction).
   */
  static getThresholds(jurisdiction?: JurisdictionCode): ComplianceThreshold[] {
    const all = Array.from(thresholds.values());
    return jurisdiction ? all.filter((t) => t.jurisdiction === jurisdiction) : all;
  }

  /**
   * Update a compliance threshold.
   */
  static updateThreshold(
    jurisdiction: JurisdictionCode,
    metric: ComplianceMetricType,
    updates: { warningLevel?: number; criticalLevel?: number },
  ): ComplianceThreshold {
    const key = `${jurisdiction}:${metric}`;
    const existing = thresholds.get(key);
    if (!existing) throw new Error(`Threshold not found: ${jurisdiction}/${metric}`);

    const updated: ComplianceThreshold = { ...existing, ...updates };
    thresholds.set(key, updated);
    return updated;
  }

  /**
   * Get jurisdiction-level compliance status summary.
   */
  static getJurisdictionStatus(): JurisdictionStatus[] {
    const jurisdictions: JurisdictionCode[] = ['US', 'EU', 'UK', 'SG', 'AU'];

    return jurisdictions.map((jurisdiction) => {
      const metrics = this.getMetrics(jurisdiction);
      const kycMetric = metrics.find((m) => m.metric === 'kyc_verification_rate');
      const amlMetric = metrics.find((m) => m.metric === 'aml_flag_rate');
      const highRiskMetric = metrics.find((m) => m.metric === 'high_risk_ratio');

      const hasCritical = metrics.some((m) => m.status === 'critical');
      const hasWarning = metrics.some((m) => m.status === 'warn');

      return {
        jurisdiction,
        overallStatus: hasCritical ? 'non_compliant' : hasWarning ? 'review_required' : 'compliant',
        kycComplianceRate: kycMetric?.value ?? 0,
        amlFlagRate: amlMetric?.value ?? 0,
        transactionVolume: Math.floor(Math.random() * 50_000) + 10_000,
        highRiskCount: Math.floor((highRiskMetric?.value ?? 0) * 100),
        lastChecked: new Date().toISOString(),
      };
    });
  }

  // ─── Alerts ─────────────────────────────────────────────────────────────────

  static getAlerts(status?: ComplianceAlertStatus, jurisdiction?: JurisdictionCode): ComplianceAlert[] {
    let all = Array.from(alerts.values());
    if (status) all = all.filter((a) => a.status === status);
    if (jurisdiction) all = all.filter((a) => a.jurisdiction === jurisdiction);
    return all.sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime());
  }

  static createAlert(
    type: ComplianceMetricType,
    severity: ComplianceAlertSeverity,
    message: string,
    jurisdiction: JurisdictionCode,
    details: Record<string, unknown> = {},
  ): ComplianceAlert {
    const alert: ComplianceAlert = {
      id: `alert_${randomUUID()}`,
      type,
      severity,
      status: 'open',
      message,
      details,
      jurisdiction,
      triggeredAt: new Date().toISOString(),
    };
    alerts.set(alert.id, alert);
    return alert;
  }

  static acknowledgeAlert(id: string, userId: string): ComplianceAlert {
    const alert = alerts.get(id);
    if (!alert) throw new Error(`Alert not found: ${id}`);
    if (alert.status !== 'open') throw new Error(`Alert is already ${alert.status}`);

    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date().toISOString();
    alert.acknowledgedBy = userId;
    alerts.set(id, alert);
    return alert;
  }

  static resolveAlert(id: string, userId: string): ComplianceAlert {
    const alert = alerts.get(id);
    if (!alert) throw new Error(`Alert not found: ${id}`);

    alert.status = 'resolved';
    alert.resolvedAt = new Date().toISOString();
    alert.acknowledgedBy = userId;
    alerts.set(id, alert);
    return alert;
  }

  /**
   * Auto-evaluate metrics and raise alerts for threshold breaches.
   */
  static evaluateThresholds(): ComplianceAlert[] {
    const newAlerts: ComplianceAlert[] = [];
    const jurisdictions: JurisdictionCode[] = ['GLOBAL', 'US', 'EU', 'UK'];

    for (const jurisdiction of jurisdictions) {
      const metrics = this.getMetrics(jurisdiction);
      for (const metric of metrics) {
        if (metric.status === 'pass') continue;

        const message =
          metric.status === 'critical'
            ? `CRITICAL: ${metric.metric} breached critical threshold in ${jurisdiction} (value: ${metric.value})`
            : `WARNING: ${metric.metric} approaching threshold in ${jurisdiction} (value: ${metric.value})`;

        const alert = this.createAlert(
          metric.metric,
          metric.status as ComplianceAlertSeverity,
          message,
          jurisdiction,
          { value: metric.value, threshold: thresholds.get(`${jurisdiction}:${metric.metric}`) },
        );
        newAlerts.push(alert);
      }
    }

    return newAlerts;
  }

  // ─── Reports ─────────────────────────────────────────────────────────────────

  static async requestReport(period: string, jurisdiction: JurisdictionCode): Promise<ComplianceReport> {
    const report: ComplianceReport = {
      id: `report_${randomUUID()}`,
      period,
      jurisdiction,
      status: 'pending',
      metrics: this.getDashboardMetrics(jurisdiction),
      jurisdictionBreakdown: this.getJurisdictionStatus(),
      alerts: this.getAlerts(undefined, jurisdiction),
      requestedAt: new Date().toISOString(),
    };
    reports.set(report.id, report);
    return report;
  }

  static getReport(id: string): ComplianceReport | null {
    return reports.get(id) ?? null;
  }

  static listReports(): ComplianceReport[] {
    return Array.from(reports.values()).sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    );
  }

  static markReportReady(id: string): ComplianceReport {
    const report = reports.get(id);
    if (!report) throw new Error(`Report not found: ${id}`);
    report.status = 'ready';
    report.generatedAt = new Date().toISOString();
    reports.set(id, report);
    return report;
  }

  // ─── Audit trail ─────────────────────────────────────────────────────────────

  static addAuditEntry(
    action: string,
    entityType: string,
    entityId: string,
    userId: string,
    jurisdiction: JurisdictionCode,
    details: Record<string, unknown> = {},
    ipAddress?: string,
  ): AuditTrailEntry {
    const entry: AuditTrailEntry = {
      id: `audit_${randomUUID()}`,
      action,
      entityType,
      entityId,
      userId,
      jurisdiction,
      details,
      timestamp: new Date().toISOString(),
      ipAddress,
    };
    auditTrail.push(entry);
    return entry;
  }

  static getAuditTrail(
    entityType?: string,
    jurisdiction?: JurisdictionCode,
    limit = 100,
  ): AuditTrailEntry[] {
    let entries = [...auditTrail];
    if (entityType) entries = entries.filter((e) => e.entityType === entityType);
    if (jurisdiction) entries = entries.filter((e) => e.jurisdiction === jurisdiction);
    return entries
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  // ─── Export ──────────────────────────────────────────────────────────────────

  static exportMetricsAsCSV(jurisdiction: JurisdictionCode = 'GLOBAL'): string {
    const metrics = this.getMetrics(jurisdiction);
    const header = 'metric,value,previousValue,changePercent,jurisdiction,status,timestamp';
    const rows = metrics.map(
      (m) => `${m.metric},${m.value},${m.previousValue},${m.changePercent},${m.jurisdiction},${m.status},${m.timestamp}`,
    );
    return [header, ...rows].join('\n');
  }

  static exportReportAsJSON(reportId: string): string {
    const report = this.getReport(reportId);
    if (!report) throw new Error(`Report not found: ${reportId}`);
    return JSON.stringify(report, null, 2);
  }
}
