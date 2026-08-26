/**
 * Compliance Automation Orchestrator
 *
 * Coordinates automated compliance checks, regulatory monitoring,
 * reporting, alerting, audit trail, and dashboard generation.
 *
 * Acceptance Criteria fulfilled:
 * - Automated compliance checks
 * - Regulatory update monitoring
 * - Compliance reporting
 * - Compliance alerts
 * - Compliance audit trail
 * - Compliance dashboard
 */

import { randomUUID } from 'crypto';
import { RegulatoryMonitorService, JurisdictionCode as RegulatoryJurisdiction } from './regulatory-monitor.js';
import {
  runAutomatedComplianceChecks,
  getLatestRun,
  getComplianceHistory,
  ComplianceCheckCategory,
  ComplianceRunSummary,
} from '../compliance/engine.js';
import { ComplianceService, JurisdictionCode } from './complianceService.js';

export type AutomationTaskType = 'checks' | 'threshold_eval' | 'regulatory_poll' | 'report_generation';
export type AutomationTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AutomationTask {
  id: string;
  type: AutomationTaskType;
  status: AutomationTaskStatus;
  jurisdiction?: string;
  triggeredBy: 'scheduler' | 'manual' | 'webhook' | 'alert';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  result?: unknown;
  error?: string;
}

export interface ComplianceDashboardData {
  overview: {
    totalChecks: number;
    passed: number;
    failed: number;
    warnings: number;
    overallScore: number;
    overallStatus: 'compliant' | 'review_required' | 'non_compliant';
    lastRunAt: string | null;
  };
  metrics: ReturnType<typeof ComplianceService.getDashboardMetrics>;
  jurisdictionStatus: ReturnType<typeof ComplianceService.getJurisdictionStatus>;
  recentAlerts: ReturnType<typeof ComplianceService.getAlerts>;
  regulatory: {
    metrics: ReturnType<typeof RegulatoryMonitorService.getMetrics>;
    recentUpdates: ReturnType<typeof RegulatoryMonitorService.getUpdates>;
    upcomingDeadlines: ReturnType<typeof RegulatoryMonitorService.getUpcomingDeadlines>;
  };
  automation: {
    recentRuns: ComplianceRunSummary[];
    latestRun: ComplianceRunSummary | null;
    taskHistory: AutomationTask[];
  };
  complianceHistory: ComplianceRunSummary[];
  generatedAt: string;
}

const taskHistory: AutomationTask[] = [];
const MAX_TASK_HISTORY = 100;

function createTask(type: AutomationTaskType, triggeredBy: AutomationTask['triggeredBy'], jurisdiction?: string): AutomationTask {
  const task: AutomationTask = {
    id: `auto_${randomUUID()}`,
    type,
    status: 'pending',
    jurisdiction,
    triggeredBy,
    startedAt: new Date().toISOString(),
  };
  taskHistory.push(task);
  if (taskHistory.length > MAX_TASK_HISTORY) taskHistory.shift();
  return task;
}

function completeTask(task: AutomationTask, result?: unknown): void {
  task.status = 'completed';
  task.completedAt = new Date().toISOString();
  task.durationMs = new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime();
  task.result = result;
}

function failTask(task: AutomationTask, error: string): void {
  task.status = 'failed';
  task.completedAt = new Date().toISOString();
  task.durationMs = new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime();
  task.error = error;
}

export class ComplianceAutomationService {
  /**
   * Run full automated compliance evaluation cycle
   */
  static async runAutomatedChecks(
    jurisdiction: JurisdictionCode = 'GLOBAL',
    category?: ComplianceCheckCategory,
    triggeredBy: AutomationTask['triggeredBy'] = 'manual',
  ): Promise<{ summary: ComplianceRunSummary; task: AutomationTask }> {
    const task = createTask('checks', triggeredBy, jurisdiction);
    task.status = 'running';

    try {
      const summary = await runAutomatedComplianceChecks(jurisdiction, category);

      // Auto-generate alerts for failures
      for (const result of summary.results) {
        if (result.status === 'fail' || result.status === 'error') {
          ComplianceService.createAlert(
            'transaction_volume' as any,
            result.severity === 'critical' ? 'critical' : result.severity === 'high' ? 'warning' : 'info',
            `Compliance check failed: ${result.name} - ${result.description}`,
            jurisdiction as any,
            {
              checkId: result.id,
              category: result.category,
              evidence: result.details,
              score: result.score,
              remediation: result.remediation,
              regulatoryRef: result.regulatoryRef,
            },
          );

          ComplianceService.addAuditEntry(
            'compliance_check_failed',
            'compliance_check',
            result.id,
            'system',
            jurisdiction as any,
            {
              name: result.name,
              severity: result.severity,
              status: result.status,
              remediation: result.remediation,
            },
          );
        }
      }

      // Also evaluate thresholds to capture metric breaches
      const thresholdAlerts = ComplianceService.evaluateThresholds();
      ComplianceService.addAuditEntry(
        'automated_compliance_run',
        'compliance_run',
        summary.runId,
        'system',
        jurisdiction as any,
        {
          totalChecks: summary.totalChecks,
          passed: summary.passed,
          failed: summary.failed,
          overallScore: summary.overallScore,
          thresholdAlertsRaised: thresholdAlerts.length,
        },
      );

      completeTask(task, summary);
      return { summary, task };
    } catch (err) {
      const msg = (err as Error).message;
      failTask(task, msg);
      throw err;
    }
  }

  static async pollRegulatoryUpdates(
    triggeredBy: AutomationTask['triggeredBy'] = 'scheduler',
  ): Promise<{ result: Awaited<ReturnType<typeof RegulatoryMonitorService.pollSources>>; task: AutomationTask }> {
    const task = createTask('regulatory_poll', triggeredBy);
    task.status = 'running';

    try {
      const pollResult = await RegulatoryMonitorService.pollSources();

      // If new regulatory updates are critical, create compliance alerts
      if (pollResult.newUpdates > 0) {
        const newUpdates = RegulatoryMonitorService.getUpdates({ status: 'new', limit: pollResult.newUpdates });
        for (const upd of newUpdates) {
          if (upd.impactLevel === 'critical' || upd.impactLevel === 'high') {
            ComplianceService.createAlert(
              'transaction_volume' as any,
              upd.impactLevel === 'critical' ? 'critical' : 'warning',
              `New regulatory update: ${upd.title} [${upd.jurisdiction}]`,
              upd.jurisdiction as any,
              {
                regulatoryUpdateId: upd.id,
                source: upd.sourceName,
                impactLevel: upd.impactLevel,
                requiredActions: upd.requiredActions,
                complianceDeadline: upd.complianceDeadline,
              },
            );
          }
        }
      }

      ComplianceService.addAuditEntry(
        'regulatory_poll',
        'regulatory_source',
        'all',
        'system',
        'GLOBAL' as any,
        {
          polled: pollResult.polled,
          newUpdates: pollResult.newUpdates,
          errors: pollResult.errors.length,
        },
      );

      completeTask(task, pollResult);
      return { result: pollResult, task };
    } catch (err) {
      const msg = (err as Error).message;
      failTask(task, msg);
      throw err;
    }
  }

  static async runFullCycle(
    jurisdiction: JurisdictionCode = 'GLOBAL',
    triggeredBy: AutomationTask['triggeredBy'] = 'scheduler',
  ): Promise<{
    checks: ComplianceRunSummary;
    regulatory: Awaited<ReturnType<typeof RegulatoryMonitorService.pollSources>>;
    reports: { period: string; count: number };
    tasks: AutomationTask[];
  }> {
    const checksRes = await this.runAutomatedChecks(jurisdiction, undefined, triggeredBy);
    const regulatoryRes = await this.pollRegulatoryUpdates(triggeredBy);

    // Auto-generate monthly reports if needed
    const now = new Date();
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = now.getMonth() === 0 ? 12 : now.getMonth();
    const period = `${year}-${String(month).padStart(2, '0')}`;

    const jurisdictions: JurisdictionCode[] = ['GLOBAL', 'US', 'EU', 'UK', 'SG', 'AU'];
    let reportCount = 0;
    for (const j of jurisdictions) {
      try {
        const report = await ComplianceService.requestReport(period, j);
        ComplianceService.markReportReady(report.id);
        reportCount++;
      } catch {
        // ignore individual report failures
      }
    }

    return {
      checks: checksRes.summary,
      regulatory: regulatoryRes.result,
      reports: { period, count: reportCount },
      tasks: [checksRes.task, regulatoryRes.task],
    };
  }

  static getDashboard(
    jurisdiction?: JurisdictionCode,
  ): ComplianceDashboardData {
    const latestRun = getLatestRun();
    const history = getComplianceHistory(10);
    const metrics = ComplianceService.getDashboardMetrics(jurisdiction);
    const jurisdictionStatus = ComplianceService.getJurisdictionStatus();
    const recentAlerts = ComplianceService.getAlerts(undefined, jurisdiction).slice(0, 10);
    const regulatoryMetrics = RegulatoryMonitorService.getMetrics();
    const recentUpdates = RegulatoryMonitorService.getUpdates({ limit: 10 });
    const upcomingDeadlines = RegulatoryMonitorService.getUpcomingDeadlines(60);

    const overviewRun = latestRun
      ? {
          totalChecks: latestRun.totalChecks,
          passed: latestRun.passed,
          failed: latestRun.failed,
          warnings: latestRun.warnings,
          overallScore: latestRun.overallScore,
          overallStatus: latestRun.overallStatus,
          lastRunAt: latestRun.completedAt,
        }
      : {
          totalChecks: 0,
          passed: 0,
          failed: 0,
          warnings: 0,
          overallScore: 0,
          overallStatus: 'compliant' as const,
          lastRunAt: null,
        };

    return {
      overview: overviewRun,
      metrics,
      jurisdictionStatus,
      recentAlerts,
      regulatory: {
        metrics: regulatoryMetrics,
        recentUpdates,
        upcomingDeadlines,
      },
      automation: {
        recentRuns: history,
        latestRun,
        taskHistory: [...taskHistory].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 20),
      },
      complianceHistory: history,
      generatedAt: new Date().toISOString(),
    };
  }

  static getTaskHistory(limit = 20): AutomationTask[] {
    return [...taskHistory]
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit);
  }

  static getAutomationMetrics(): {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    avgDurationMs: number;
    lastRun: AutomationTask | null;
  } {
    const all = [...taskHistory];
    const completed = all.filter((t) => t.status === 'completed');
    const failed = all.filter((t) => t.status === 'failed');
    const avgDuration =
      completed.length > 0 ? completed.reduce((sum, t) => sum + (t.durationMs ?? 0), 0) / completed.length : 0;

    return {
      totalRuns: all.length,
      successfulRuns: completed.length,
      failedRuns: failed.length,
      avgDurationMs: Math.round(avgDuration),
      lastRun: all.length > 0 ? [...all].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0] : null,
    };
  }
}
