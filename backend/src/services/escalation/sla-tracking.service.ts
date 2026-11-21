/**
 * SLA Tracking Service — Issue #646
 *
 * Tracks SLA compliance per issue type and severity. Records breaches
 * when response or resolution time targets are exceeded. Provides
 * analytics aggregation for dashboard reporting.
 *
 * ## Features
 * - Per-issue-type SLA configuration
 * - Response time and resolution time tracking
 * - Automatic breach detection and recording
 * - Warning threshold alerts (e.g., 80% of SLA deadline)
 * - Business-hours-aware timing
 * - Analytics aggregation for dashboards
 */

import { prisma } from '../../lib/prisma.js';
import { notificationDispatcher } from '../../notifications/dispatcher.js';
import type { Notification } from '../../notifications/channel-interface.js';
import { v4 as uuidv4 } from 'uuid';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IssueType =
  | 'dispute'
  | 'payment_discrepancy'
  | 'fraud_alert'
  | 'compliance_review'
  | 'support_ticket'
  | 'account_issue'
  | 'system_incident';

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';

export type SLAStatus = 'compliant' | 'at_risk' | 'breached' | 'resolved';

export interface SLAConfigInput {
  tenantId: string;
  issueType: IssueType;
  severity: IssueSeverity;
  name: string;
  description?: string;
  responseTimeMins: number;
  resolutionTimeMins: number;
  warningThresholdPct?: number;
  businessHoursOnly?: boolean;
  timezone?: string;
}

export interface SLABreachResult {
  breached: boolean;
  atRisk: boolean;
  breachType: 'response_time' | 'resolution_time' | null;
  breachId?: string;
  targetMins: number;
  actualMins: number;
}

// ─── Business Hours Helper ─────────────────────────────────────────────────────

function isBusinessHour(date: Date, timezone: string = 'UTC'): boolean {
  const hour = date.getUTCHours(); // Simplified; in production, use timezone lib
  const day = date.getUTCDay();
  // Mon-Fri, 9am-5pm UTC (simplified)
  return day >= 1 && day <= 5 && hour >= 9 && hour < 17;
}

function effectiveElapsedMins(
  start: Date,
  end: Date,
  businessHoursOnly: boolean,
  timezone: string,
): number {
  if (!businessHoursOnly) {
    return Math.floor((end.getTime() - start.getTime()) / 60000);
  }

  // Approximate business-hours elapsed time
  // Full implementation would use a proper calendar library
  let elapsed = 0;
  const current = new Date(start);
  while (current < end) {
    if (isBusinessHour(current, timezone)) {
      elapsed++;
    }
    current.setMinutes(current.getMinutes() + 1);
  }
  return elapsed;
}

// ─── SLATrackingService ───────────────────────────────────────────────────────

export class SLATrackingService {
  /**
   * Create or update an SLA configuration for an issue type.
   */
  async upsertSLA(input: SLAConfigInput) {
    return prisma.issueSLA.upsert({
      where: {
        tenantId_issueType_severity: {
          tenantId: input.tenantId,
          issueType: input.issueType,
          severity: input.severity,
        },
      },
      create: {
        tenantId: input.tenantId,
        issueType: input.issueType,
        severity: input.severity,
        name: input.name,
        description: input.description,
        responseTimeMins: input.responseTimeMins,
        resolutionTimeMins: input.resolutionTimeMins,
        warningThresholdPct: input.warningThresholdPct ?? 80,
        businessHoursOnly: input.businessHoursOnly ?? false,
        timezone: input.timezone ?? 'UTC',
      },
      update: {
        name: input.name,
        description: input.description,
        responseTimeMins: input.responseTimeMins,
        resolutionTimeMins: input.resolutionTimeMins,
        warningThresholdPct: input.warningThresholdPct ?? 80,
        businessHoursOnly: input.businessHoursOnly ?? false,
        timezone: input.timezone ?? 'UTC',
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get all SLA configs for a tenant.
   */
  async getSLAs(tenantId: string, issueType?: IssueType) {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (issueType) where.issueType = issueType;

    return prisma.issueSLA.findMany({
      where,
      include: {
        rule: { select: { id: true, name: true } },
      },
      orderBy: [{ issueType: 'asc' }, { severity: 'asc' }],
    });
  }

  /**
   * Get a specific SLA config.
   */
  async getSLA(tenantId: string, issueType: IssueType, severity: IssueSeverity) {
    return prisma.issueSLA.findFirst({
      where: { tenantId, issueType, severity, deletedAt: null },
    });
  }

  /**
   * Soft-delete an SLA config.
   */
  async deleteSLA(id: string, tenantId: string) {
    return prisma.issueSLA.updateMany({
      where: { id, tenantId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Check SLA compliance for a specific issue and record breaches if any.
   */
  async checkSLA(
    tenantId: string,
    issueId: string,
    issueType: IssueType,
    severity: IssueSeverity,
    context: {
      createdAt: Date;
      lastResponseAt?: Date;
      resolvedAt?: Date;
    },
  ): Promise<SLABreachResult> {
    const sla = await this.getSLA(tenantId, issueType, severity);

    if (!sla) {
      return {
        breached: false,
        atRisk: false,
        breachType: null,
        targetMins: 0,
        actualMins: 0,
      };
    }

    const now = new Date();
    const responseTime = context.lastResponseAt
      ? effectiveElapsedMins(context.createdAt, context.lastResponseAt, sla.businessHoursOnly, sla.timezone)
      : effectiveElapsedMins(context.createdAt, now, sla.businessHoursOnly, sla.timezone);

    const resolutionTime = context.resolvedAt
      ? effectiveElapsedMins(context.createdAt, context.resolvedAt, sla.businessHoursOnly, sla.timezone)
      : effectiveElapsedMins(context.createdAt, now, sla.businessHoursOnly, sla.timezone);

    const warningResponseTime = sla.responseTimeMins * (sla.warningThresholdPct / 100);
    const warningResolutionTime = sla.resolutionTimeMins * (sla.warningThresholdPct / 100);

    // Check for breaches
    if (!context.resolvedAt && responseTime > sla.responseTimeMins) {
      return this.recordBreach(
        tenantId, issueId, issueType, severity, sla.id,
        'response_time', sla.responseTimeMins, responseTime,
      );
    }

    if (!context.resolvedAt && resolutionTime > sla.resolutionTimeMins) {
      return this.recordBreach(
        tenantId, issueId, issueType, severity, sla.id,
        'resolution_time', sla.resolutionTimeMins, resolutionTime,
      );
    }

    // Check for at-risk (warning threshold exceeded)
    if (!context.resolvedAt) {
      if (responseTime >= warningResponseTime) {
        return {
          breached: false,
          atRisk: true,
          breachType: 'response_time',
          targetMins: sla.responseTimeMins,
          actualMins: responseTime,
        };
      }

      if (resolutionTime >= warningResolutionTime) {
        return {
          breached: false,
          atRisk: true,
          breachType: 'resolution_time',
          targetMins: sla.resolutionTimeMins,
          actualMins: resolutionTime,
        };
      }
    }

    return {
      breached: false,
      atRisk: false,
      breachType: null,
      targetMins: 0,
      actualMins: 0,
    };
  }

  /**
   * Record an SLA breach and send notifications.
   */
  private async recordBreach(
    tenantId: string,
    issueId: string,
    issueType: IssueType,
    severity: IssueSeverity,
    slaId: string,
    breachType: 'response_time' | 'resolution_time',
    targetMins: number,
    actualMins: number,
  ): Promise<SLABreachResult> {
    const breachId = uuidv4();

    // Check for existing unresolved breach
    const existing = await prisma.sLABreach.findFirst({
      where: {
        tenantId,
        issueId,
        breachType,
        status: 'breached',
      },
    });

    if (existing) {
      // Update the existing breach
      await prisma.sLABreach.update({
        where: { id: existing.id },
        data: { actualMins, updatedAt: new Date() },
      });

      return {
        breached: true,
        atRisk: false,
        breachType,
        breachId: existing.id,
        targetMins,
        actualMins,
      };
    }

    // Create new breach record
    await prisma.sLABreach.create({
      data: {
        id: breachId,
        tenantId,
        slaId,
        issueId,
        issueType,
        severity,
        breachType,
        targetMins,
        actualMins,
        status: 'breached',
        notifiedAt: new Date(),
      },
    });

    // Send breach notification
    await this.sendBreachNotification(tenantId, issueId, issueType, severity, breachType, targetMins, actualMins);

    return {
      breached: true,
      atRisk: false,
      breachType,
      breachId,
      targetMins,
      actualMins,
    };
  }

  /**
   * Send SLA breach notification.
   */
  private async sendBreachNotification(
    tenantId: string,
    issueId: string,
    issueType: string,
    severity: string,
    breachType: string,
    targetMins: number,
    actualMins: number,
  ): Promise<void> {
    const notification: Notification = {
      id: `sla-breach-${issueId}-${breachType}-${Date.now()}`,
      userId: 'system',
      eventType: 'sla.breach',
      title: `SLA Breach: ${issueType} - ${severity}`,
      body: `SLA ${breachType} breached for issue #${issueId}. Target: ${targetMins} mins, Actual: ${actualMins} mins.`,
      priority: severity === 'critical' || severity === 'high' ? 'high' : 'normal',
      metadata: {
        issueId,
        issueType,
        severity,
        breachType,
        targetMins: String(targetMins),
        actualMins: String(actualMins),
        tenantId,
      },
      createdAt: new Date(),
    };

    try {
      await notificationDispatcher.dispatch(notification);
    } catch (error) {
      console.error('[SLATrackingService] Failed to send breach notification:', error);
    }
  }

  /**
   * Get all SLA breaches for a tenant.
   */
  async getBreaches(
    tenantId: string,
    filters?: {
      issueId?: string;
      issueType?: IssueType;
      status?: SLAStatus;
      limit?: number;
    },
  ) {
    const where: Record<string, unknown> = { tenantId };
    if (filters?.issueId) where.issueId = filters.issueId;
    if (filters?.issueType) where.issueType = filters.issueType;
    if (filters?.status) where.status = filters.status;

    return prisma.sLABreach.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters?.limit ?? 50,
      include: {
        sla: { select: { id: true, name: true, responseTimeMins: true, resolutionTimeMins: true } },
      },
    });
  }

  /**
   * Resolve an SLA breach.
   */
  async resolveBreach(breachId: string) {
    return prisma.sLABreach.update({
      where: { id: breachId },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
  }

  /**
   * Aggregate escalation analytics for a period.
   */
  async aggregateAnalytics(
    tenantId: string,
    period: 'daily' | 'weekly' | 'monthly' = 'daily',
  ): Promise<void> {
    const now = new Date();
    let periodStart: Date;
    const periodEnd = now;

    switch (period) {
      case 'weekly':
        periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    const issueTypes: IssueType[] = [
      'dispute', 'payment_discrepancy', 'fraud_alert',
      'compliance_review', 'support_ticket', 'account_issue', 'system_incident',
    ];
    const severities: IssueSeverity[] = ['low', 'medium', 'high', 'critical'];

    for (const issueType of issueTypes) {
      for (const severity of severities) {
        // Count escalation events
        const escalatedCount = await prisma.escalationEvent.count({
          where: {
            tenantId,
            issueType,
            severity,
            createdAt: { gte: periodStart, lte: periodEnd },
          },
        });

        // Count SLA breaches
        const slaBreachCount = await prisma.sLABreach.count({
          where: {
            tenantId,
            issueType,
            severity,
            createdAt: { gte: periodStart, lte: periodEnd },
          },
        });

        // Count resolved breaches
        const resolvedCount = await prisma.sLABreach.count({
          where: {
            tenantId,
            issueType,
            severity,
            status: 'resolved',
            updatedAt: { gte: periodStart, lte: periodEnd },
          },
        });

        // Calculate totals
        const totalEvents = escalatedCount + slaBreachCount;
        const totalResolved = resolvedCount;
        const slaCompliancePct = totalEvents > 0
          ? ((totalEvents - slaBreachCount) / totalEvents) * 100
          : 100;

        // Current open breaches
        const openCount = await prisma.sLABreach.count({
          where: { tenantId, issueType, severity, status: { in: ['breached', 'at_risk'] } },
        });

        const atRiskCount = await prisma.sLABreach.count({
          where: { tenantId, issueType, severity, status: 'at_risk' },
        });

        // Upsert analytics
        await prisma.escalationAnalytics.upsert({
          where: {
            tenantId_issueType_severity_period_periodStart: {
              tenantId,
              issueType,
              severity,
              period,
              periodStart,
            },
          },
          create: {
            tenantId,
            issueType,
            severity,
            period,
            periodStart,
            periodEnd,
            totalIssues: totalEvents,
            escalatedCount,
            slaBreachCount,
            resolvedCount: totalResolved,
            slaCompliancePct: Math.round(slaCompliancePct * 100) / 100,
            openCount,
            atRiskCount,
          },
          update: {
            totalIssues: totalEvents,
            escalatedCount,
            slaBreachCount,
            resolvedCount: totalResolved,
            slaCompliancePct: Math.round(slaCompliancePct * 100) / 100,
            openCount,
            atRiskCount,
            periodEnd,
            updatedAt: new Date(),
          },
        });
      }
    }

    console.log(
      `[SLATrackingService] Analytics aggregated for tenant ${tenantId} (${period})`,
    );
  }

  /**
   * Get analytics data for dashboard.
   */
  async getAnalytics(
    tenantId: string,
    filters?: {
      issueType?: IssueType;
      period?: 'daily' | 'weekly' | 'monthly';
      limit?: number;
    },
  ) {
    const where: Record<string, unknown> = { tenantId };
    if (filters?.issueType) where.issueType = filters.issueType;
    if (filters?.period) where.period = filters.period;

    return prisma.escalationAnalytics.findMany({
      where,
      orderBy: { periodStart: 'desc' },
      take: filters?.limit ?? 30,
    });
  }
}

export const slaTrackingService = new SLATrackingService();
