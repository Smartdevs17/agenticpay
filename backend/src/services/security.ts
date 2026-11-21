/**
 * security.ts — Issue #594
 *
 * Security scanning service for automated SAST/DAST/dependency vulnerability
 * tracking, severity classification, SLA management, and security scoring.
 */

import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService.js';
import type { Result } from '../lib/result.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type VulnerabilityStatus = 'open' | 'in_progress' | 'resolved' | 'accepted' | 'false_positive';
export type ScanType = 'sast' | 'dast' | 'dependency' | 'smart_contract';

export interface Vulnerability {
  id: string;
  title: string;
  description: string;
  severity: VulnerabilitySeverity;
  status: VulnerabilityStatus;
  scanType: ScanType;
  /** File path or URL where the vulnerability was found */
  location: string;
  lineNumber?: number;
  cveId?: string;
  cvssScore?: number;
  packageName?: string;
  packageVersion?: string;
  fixedInVersion?: string;
  remediation: string;
  assignedTo?: string;
  slaDueAt: string;
  resolvedAt?: string;
  detectedAt: string;
  updatedAt: string;
}

export interface ScanReport {
  id: string;
  scanType: ScanType;
  triggeredBy: string; // 'ci' | 'manual' | 'scheduled'
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  vulnerabilitiesFound: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  vulnerabilityIds: string[];
  error?: string;
}

export interface SecurityScore {
  overall: number;        // 0-100
  sast: number;
  dast: number;
  dependency: number;
  smartContract: number;
  trend: 'improving' | 'stable' | 'degrading';
  lastCalculatedAt: string;
}

export interface RemediationWorkflow {
  vulnerabilityId: string;
  assignedTo: string;
  priority: VulnerabilitySeverity;
  notes: string;
  assignedAt: string;
}

// ── SLA by severity (days to resolve) ────────────────────────────────────────

const SLA_DAYS: Record<VulnerabilitySeverity, number> = {
  critical: 1,
  high: 7,
  medium: 30,
  low: 90,
  info: 180,
};

// ── In-memory stores ──────────────────────────────────────────────────────────

const vulnerabilities = new Map<string, Vulnerability>();
const scanReports = new Map<string, ScanReport>();
const scoreHistory: SecurityScore[] = [];

// ── Service ───────────────────────────────────────────────────────────────────

export class SecurityService extends BaseService {

  // ── Start a scan ──────────────────────────────────────────────────────────

  startScan(scanType: ScanType, triggeredBy = 'manual'): Result<ScanReport> {
    const id = randomUUID();
    const report: ScanReport = {
      id,
      scanType,
      triggeredBy,
      startedAt: new Date().toISOString(),
      status: 'running',
      vulnerabilitiesFound: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      vulnerabilityIds: [],
    };
    scanReports.set(id, report);
    return this.ok(report);
  }

  // ── Complete a scan and record findings ───────────────────────────────────

  completeScan(
    scanId: string,
    findings: Array<{
      title: string;
      description: string;
      severity: VulnerabilitySeverity;
      location: string;
      lineNumber?: number;
      cveId?: string;
      cvssScore?: number;
      packageName?: string;
      packageVersion?: string;
      fixedInVersion?: string;
      remediation: string;
    }>,
  ): Result<ScanReport> {
    const report = scanReports.get(scanId);
    if (!report) return this.notFoundFailure('ScanReport', scanId);
    if (report.status !== 'running') {
      return this.validationFailure('Scan is not in running state');
    }

    const now = new Date().toISOString();
    const counts: Record<VulnerabilitySeverity, number> = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
    };

    for (const finding of findings) {
      const dueDate = new Date(
        Date.now() + SLA_DAYS[finding.severity] * 24 * 60 * 60 * 1_000,
      ).toISOString();

      const vuln: Vulnerability = {
        id: randomUUID(),
        ...finding,
        status: 'open',
        scanType: report.scanType,
        slaDueAt: dueDate,
        detectedAt: now,
        updatedAt: now,
      };

      vulnerabilities.set(vuln.id, vuln);
      report.vulnerabilityIds.push(vuln.id);
      counts[finding.severity]++;
    }

    report.vulnerabilitiesFound = findings.length;
    report.critical = counts.critical;
    report.high = counts.high;
    report.medium = counts.medium;
    report.low = counts.low;
    report.info = counts.info;
    report.completedAt = now;
    report.status = 'completed';
    scanReports.set(scanId, report);

    // Recalculate score after new findings
    this.calculateScore();

    return this.ok(report);
  }

  // ── Fail a scan ───────────────────────────────────────────────────────────

  failScan(scanId: string, error: string): Result<ScanReport> {
    const report = scanReports.get(scanId);
    if (!report) return this.notFoundFailure('ScanReport', scanId);
    report.status = 'failed';
    report.error = error;
    report.completedAt = new Date().toISOString();
    scanReports.set(scanId, report);
    return this.ok(report);
  }

  // ── List vulnerabilities ──────────────────────────────────────────────────

  listVulnerabilities(filters?: {
    severity?: VulnerabilitySeverity;
    status?: VulnerabilityStatus;
    scanType?: ScanType;
    overdue?: boolean;
  }): Vulnerability[] {
    let all = Array.from(vulnerabilities.values());
    const now = new Date().toISOString();

    if (filters?.severity) all = all.filter((v) => v.severity === filters.severity);
    if (filters?.status) all = all.filter((v) => v.status === filters.status);
    if (filters?.scanType) all = all.filter((v) => v.scanType === filters.scanType);
    if (filters?.overdue) {
      all = all.filter(
        (v) => v.status === 'open' || v.status === 'in_progress' ? v.slaDueAt < now : false,
      );
    }

    return all.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  // ── Update vulnerability status ────────────────────────────────────────────

  updateVulnerabilityStatus(
    vulnId: string,
    status: VulnerabilityStatus,
    _notes?: string,
  ): Result<Vulnerability> {
    const vuln = vulnerabilities.get(vulnId);
    if (!vuln) return this.notFoundFailure('Vulnerability', vulnId);

    vuln.status = status;
    vuln.updatedAt = new Date().toISOString();
    if (status === 'resolved') {
      vuln.resolvedAt = vuln.updatedAt;
    }
    vulnerabilities.set(vulnId, vuln);
    this.calculateScore();
    return this.ok(vuln);
  }

  // ── Assign vulnerability for remediation ──────────────────────────────────

  assignRemediation(
    vulnId: string,
    assignedTo: string,
    notes = '',
  ): Result<RemediationWorkflow> {
    const vuln = vulnerabilities.get(vulnId);
    if (!vuln) return this.notFoundFailure('Vulnerability', vulnId);

    vuln.assignedTo = assignedTo;
    vuln.status = 'in_progress';
    vuln.updatedAt = new Date().toISOString();
    vulnerabilities.set(vulnId, vuln);

    const workflow: RemediationWorkflow = {
      vulnerabilityId: vulnId,
      assignedTo,
      priority: vuln.severity,
      notes,
      assignedAt: vuln.updatedAt,
    };

    return this.ok(workflow);
  }

  // ── Get a single scan report ───────────────────────────────────────────────

  getScanReport(scanId: string): Result<ScanReport> {
    const report = scanReports.get(scanId);
    if (!report) return this.notFoundFailure('ScanReport', scanId);
    return this.ok(report);
  }

  // ── List scan reports ─────────────────────────────────────────────────────

  listScanReports(limit = 20): ScanReport[] {
    return Array.from(scanReports.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit);
  }

  // ── Calculate security score ──────────────────────────────────────────────

  calculateScore(): SecurityScore {
    const open = Array.from(vulnerabilities.values()).filter(
      (v) => v.status === 'open' || v.status === 'in_progress',
    );

    function scoreForType(type: ScanType): number {
      const typeVulns = open.filter((v) => v.scanType === type);
      if (typeVulns.length === 0) return 100;
      const deductions = typeVulns.reduce((sum, v) => {
        const d: Record<VulnerabilitySeverity, number> = {
          critical: 25, high: 15, medium: 8, low: 3, info: 1,
        };
        return sum + (d[v.severity] ?? 0);
      }, 0);
      return Math.max(0, 100 - deductions);
    }

    const sast = scoreForType('sast');
    const dast = scoreForType('dast');
    const dep = scoreForType('dependency');
    const sc = scoreForType('smart_contract');
    const overall = Math.round((sast + dast + dep + sc) / 4);

    let trend: SecurityScore['trend'] = 'stable';
    if (scoreHistory.length > 0) {
      const last = scoreHistory[scoreHistory.length - 1].overall;
      if (overall > last + 2) trend = 'improving';
      else if (overall < last - 2) trend = 'degrading';
    }

    const score: SecurityScore = {
      overall,
      sast,
      dast,
      dependency: dep,
      smartContract: sc,
      trend,
      lastCalculatedAt: new Date().toISOString(),
    };

    scoreHistory.push(score);
    if (scoreHistory.length > 90) scoreHistory.shift(); // keep last 90 entries

    return score;
  }

  // ── Current score ──────────────────────────────────────────────────────────

  getCurrentScore(): SecurityScore {
    if (scoreHistory.length === 0) return this.calculateScore();
    return scoreHistory[scoreHistory.length - 1];
  }

  // ── Score history ─────────────────────────────────────────────────────────

  getScoreHistory(days = 30): SecurityScore[] {
    return scoreHistory.slice(-days);
  }

  // ── Overdue SLA summary ───────────────────────────────────────────────────

  getOverdueSummary(): { total: number; critical: number; high: number; medium: number } {
    const now = new Date().toISOString();
    const overdue = Array.from(vulnerabilities.values()).filter(
      (v) =>
        (v.status === 'open' || v.status === 'in_progress') && v.slaDueAt < now,
    );
    return {
      total: overdue.length,
      critical: overdue.filter((v) => v.severity === 'critical').length,
      high: overdue.filter((v) => v.severity === 'high').length,
      medium: overdue.filter((v) => v.severity === 'medium').length,
    };
  }

  // ── Get a vulnerability by id ─────────────────────────────────────────────

  getVulnerability(vulnId: string): Result<Vulnerability> {
    const vuln = vulnerabilities.get(vulnId);
    if (!vuln) return this.notFoundFailure('Vulnerability', vulnId);
    return this.ok(vuln);
  }
}

export const securityService = new SecurityService();
