/**
 * compliance-report.job.ts — Issue #590
 *
 * Scheduled job for automated monthly compliance report generation.
 * Runs on first day of each month (configurable), evaluates thresholds,
 * generates reports for each jurisdiction, and raises alerts for breaches.
 */

import { ComplianceService, JurisdictionCode } from '../services/complianceService.js';

const JURISDICTIONS: JurisdictionCode[] = ['GLOBAL', 'US', 'EU', 'UK', 'SG', 'AU'];

export interface ComplianceJobResult {
  reportsGenerated: number;
  alertsRaised: number;
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
    errors: [],
    completedAt: '',
  };

  // Period: previous month  (e.g. "2026-06" when running in July)
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  const period = `${year}-${String(month).padStart(2, '0')}`;

  // 1. Evaluate thresholds and raise alerts
  try {
    const newAlerts = ComplianceService.evaluateThresholds();
    result.alertsRaised = newAlerts.length;
  } catch (err) {
    result.errors.push(`Alert evaluation failed: ${(err as Error).message}`);
  }

  // 2. Generate report for each jurisdiction
  for (const jurisdiction of JURISDICTIONS) {
    try {
      const report = await ComplianceService.requestReport(period, jurisdiction);
      // Simulate async generation then mark ready
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
export async function evaluateComplianceThresholds(): Promise<void> {
  ComplianceService.evaluateThresholds();
}

/**
 * Export compliance metrics for regulatory submission.
 * Called before end-of-quarter deadlines.
 */
export async function exportComplianceMetrics(jurisdiction: JurisdictionCode = 'GLOBAL'): Promise<string> {
  return ComplianceService.exportMetricsAsCSV(jurisdiction);
}
