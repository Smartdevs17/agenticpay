/**
 * compliance-report.job.ts — Automated Compliance Reporting
 *
 * Scheduled job for automated compliance report generation with full automation:
 * - Automated checks execution
 * - Threshold evaluation
 * - Regulatory polling
 * - Report generation per jurisdiction
 * - Alert generation
 * - Audit trail
 */

import { ComplianceService, JurisdictionCode } from '../services/complianceService.js';
import { ComplianceAutomationService } from '../services/compliance-automation.js';
import { RegulatoryMonitorService } from '../services/regulatory-monitor.js';

const JURISDICTIONS: JurisdictionCode[] = ['GLOBAL', 'US', 'EU', 'UK', 'SG', 'AU'];

export interface ComplianceJobResult {
  reportsGenerated: number;
  alertsRaised: number;
  checksExecuted?: number;
  complianceScore?: number;
  overallStatus?: string;
  regulatoryUpdates?: number;
  errors: string[];
  completedAt: string;
}

/**
 * Generate monthly compliance reports for all jurisdictions.
 * Called by the scheduler; can also be triggered manually via admin API.
 */
export async function generateMonthlyComplianceReports(): Promise<ComplianceJobResult> {
  const result: ComplianceJobResult = {
    reportsGenerated: 0,
    alertsRaised: 0,
    checksExecuted: 0,
    regulatoryUpdates: 0,
    errors: [],
    completedAt: '',
  };

  // Period: previous month (e.g. "2026-06" when running in July)
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  const period = `${year}-${String(month).padStart(2, '0')}`;

  // 0. Run automated compliance checks first to get fresh score
  try {
    const { summary } = await ComplianceAutomationService.runAutomatedChecks('GLOBAL', undefined, 'scheduler');
    result.checksExecuted = summary.totalChecks;
    result.complianceScore = summary.overallScore;
    result.overallStatus = summary.overallStatus;
    result.alertsRaised += summary.failed + summary.warnings;
  } catch (err) {
    result.errors.push(`Automated checks failed: ${(err as Error).message}`);
  }

  // 1. Poll regulatory updates
  try {
    const pollRes = await RegulatoryMonitorService.pollSources();
    result.regulatoryUpdates = pollRes.newUpdates;
  } catch (err) {
    result.errors.push(`Regulatory polling failed: ${(err as Error).message}`);
  }

  // 2. Evaluate thresholds and raise alerts
  try {
    const newAlerts = ComplianceService.evaluateThresholds();
    result.alertsRaised += newAlerts.length;
  } catch (err) {
    result.errors.push(`Alert evaluation failed: ${(err as Error).message}`);
  }

  // 3. Generate report for each jurisdiction
  for (const jurisdiction of JURISDICTIONS) {
    try {
      const report = await ComplianceService.requestReport(period, jurisdiction);
      // Enhance with automated check summary if available
      const scoring = ComplianceService.calculateComplianceScore(jurisdiction);
      (report as any).summary = {
        overallStatus: scoring.status,
        complianceScore: scoring.score,
        recommendations: scoring.recommendations,
      };
      ComplianceService.markReportReady(report.id);
      result.reportsGenerated++;
    } catch (err) {
      result.errors.push(`Report generation failed for ${jurisdiction}: ${(err as Error).message}`);
    }
  }

  result.completedAt = new Date().toISOString();
  return result;
}

/**
 * Evaluate thresholds and raise alerts.
 * Can run more frequently than full reports (e.g. hourly).
 */
export async function evaluateComplianceThresholds(): Promise<number> {
  const alerts = ComplianceService.evaluateThresholds();
  return alerts.length;
}

/**
 * Run full automated compliance cycle.
 */
export async function runFullComplianceCycle(jurisdiction: JurisdictionCode = 'GLOBAL') {
  return ComplianceAutomationService.runFullCycle(jurisdiction, 'scheduler');
}

/**
 * Export compliance metrics for regulatory submission.
 * Called before end-of-quarter deadlines.
 */
export async function exportComplianceMetrics(jurisdiction: JurisdictionCode = 'GLOBAL'): Promise<string> {
  return ComplianceService.exportMetricsAsCSV(jurisdiction);
}

/**
 * Generate regulatory deadline report
 */
export async function generateRegulatoryDeadlineReport(daysAhead = 60) {
  const deadlines = RegulatoryMonitorService.getUpcomingDeadlines(daysAhead);
  return {
    generatedAt: new Date().toISOString(),
    daysAhead,
    count: deadlines.length,
    deadlines,
  };
}
