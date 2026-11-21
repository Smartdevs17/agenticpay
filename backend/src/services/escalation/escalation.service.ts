/**
 * Escalation Service — Issue #646
 *
 * Core escalation engine that evaluates escalation rules, manages escalation
 * levels for issues, and records escalation events. Works alongside the
 * SLATrackingService for SLA compliance monitoring.
 *
 * ## Features
 * - Rule-based escalation with configurable chains
 * - Automatic escalation when SLA thresholds are breached
 * - Cool-down periods between escalation levels
 * - Notification integration via the notification dispatcher
 * - Full audit trail via EscalationEvent records
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

export type EscalationLevel = 'level_1' | 'level_2' | 'level_3' | 'management';

export interface EscalationRuleInput {
  tenantId: string;
  name: string;
  description?: string;
  issueType: IssueType;
  severity: IssueSeverity;
  responseTimeMins: number;
  resolutionTimeMins: number;
  escalationChain: EscalationLevel[];
  notifyChannels: { level: EscalationLevel; channels: string[] }[];
  notifyRoles: string[];
  autoEscalate?: boolean;
  cooldownMins?: number;
  priority?: number;
}

export interface EscalationResult {
  escalated: boolean;
  fromLevel: EscalationLevel;
  toLevel: EscalationLevel;
  reason: string;
  eventId?: string;
}

export interface IssueContext {
  issueId: string;
  tenantId: string;
  issueType: IssueType;
  severity: IssueSeverity;
  currentLevel: EscalationLevel;
  createdAt: Date;
  lastResponseAt?: Date;
  resolvedAt?: Date;
  metadata?: Record<string, unknown>;
}

// ─── Default Escalation Chains ─────────────────────────────────────────────────

const DEFAULT_ESCALATION_CHAINS: Record<IssueType, EscalationLevel[]> = {
  dispute: ['level_1', 'level_2', 'level_3', 'management'],
  payment_discrepancy: ['level_1', 'level_2', 'management'],
  fraud_alert: ['level_1', 'level_2', 'level_3', 'management'],
  compliance_review: ['level_1', 'level_2', 'management'],
  support_ticket: ['level_1', 'level_2'],
  account_issue: ['level_1', 'level_2', 'level_3'],
  system_incident: ['level_1', 'level_2', 'level_3', 'management'],
};

const DEFAULT_RESPONSE_TIMES: Record<IssueSeverity, number> = {
  low: 480,       // 8 hours
  medium: 240,    // 4 hours
  high: 60,       // 1 hour
  critical: 15,   // 15 minutes
};

const DEFAULT_RESOLUTION_TIMES: Record<IssueSeverity, number> = {
  low: 10080,     // 7 days
  medium: 4320,   // 3 days
  high: 1440,     // 1 day
  critical: 240,  // 4 hours
};

// ─── EscalationService ────────────────────────────────────────────────────────

export class EscalationService {
  /**
   * Seed default escalation rules for a tenant if none exist.
   */
  async seedDefaultRules(tenantId: string): Promise<void> {
    const existingCount = await prisma.escalationRule.count({
      where: { tenantId, deletedAt: null },
    });

    if (existingCount > 0) return;

    const issueTypes: IssueType[] = [
      'dispute', 'payment_discrepancy', 'fraud_alert',
      'compliance_review', 'support_ticket', 'account_issue', 'system_incident',
    ];

    for (const issueType of issueTypes) {
      for (const severity of ['low', 'medium', 'high', 'critical'] as IssueSeverity[]) {
        const chain = DEFAULT_ESCALATION_CHAINS[issueType];
        const responseTime = DEFAULT_RESPONSE_TIMES[severity];
        const resolutionTime = DEFAULT_RESOLUTION_TIMES[severity];

        await prisma.escalationRule.create({
          data: {
            tenantId,
            name: `${issueType}_${severity}`,
            description: `Default escalation rule for ${issueType} (${severity})`,
            issueType,
            severity,
            responseTimeMins: responseTime,
            resolutionTimeMins: resolutionTime,
            escalationChain: chain,
            notifyChannels: chain.map((level) => ({
              level,
              channels: ['in-app', 'email'],
            })),
            notifyRoles: ['admin', 'operator'],
            autoEscalate: true,
            cooldownMins: 60,
            priority: severity === 'critical' ? 100 : severity === 'high' ? 75 : 50,
          },
        });
      }
    }

    console.log(`[EscalationService] Seeded default rules for tenant ${tenantId}`);
  }

  /**
   * Create a custom escalation rule.
   */
  async createRule(input: EscalationRuleInput) {
    return prisma.escalationRule.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        description: input.description,
        issueType: input.issueType,
        severity: input.severity,
        responseTimeMins: input.responseTimeMins,
        resolutionTimeMins: input.resolutionTimeMins,
        escalationChain: input.escalationChain,
        notifyChannels: input.notifyChannels,
        notifyRoles: input.notifyRoles,
        autoEscalate: input.autoEscalate ?? true,
        cooldownMins: input.cooldownMins ?? 60,
        priority: input.priority ?? 0,
      },
    });
  }

  /**
   * Get all escalation rules for a tenant, optionally filtered by issue type.
   */
  async getRules(tenantId: string, issueType?: IssueType) {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (issueType) where.issueType = issueType;

    return prisma.escalationRule.findMany({
      where,
      orderBy: { priority: 'desc' },
    });
  }

  /**
   * Update an escalation rule.
   */
  async updateRule(id: string, tenantId: string, input: Partial<EscalationRuleInput>) {
    return prisma.escalationRule.updateMany({
      where: { id, tenantId },
      data: { ...input, updatedAt: new Date() },
    });
  }

  /**
   * Soft-delete an escalation rule.
   */
  async deleteRule(id: string, tenantId: string) {
    return prisma.escalationRule.updateMany({
      where: { id, tenantId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Find the matching escalation rule for an issue.
   */
  async findRule(tenantId: string, issueType: IssueType, severity: IssueSeverity) {
    // Try exact severity match first, fall back to 'high' for 'critical' if not found
    const severitiesToCheck = severity === 'critical'
      ? ['critical', 'high'] as IssueSeverity[]
      : [severity];

    return prisma.escalationRule.findFirst({
      where: {
        tenantId,
        issueType,
        severity: { in: severitiesToCheck },
        isActive: true,
        deletedAt: null,
      },
      orderBy: { priority: 'desc' },
    });
  }

  /**
   * Determine if an issue should be escalated based on its current state
   * and the applicable escalation rule.
   */
  async evaluateEscalation(context: IssueContext): Promise<EscalationResult> {
    const rule = await this.findRule(context.tenantId, context.issueType, context.severity);

    if (!rule) {
      return {
        escalated: false,
        fromLevel: context.currentLevel,
        toLevel: context.currentLevel,
        reason: 'No applicable escalation rule found',
      };
    }

    const chain = rule.escalationChain as EscalationLevel[];
    const currentIdx = chain.indexOf(context.currentLevel);

    // Already at max level
    if (currentIdx >= chain.length - 1) {
      return {
        escalated: false,
        fromLevel: context.currentLevel,
        toLevel: context.currentLevel,
        reason: 'Already at maximum escalation level',
      };
    }

    const now = new Date();
    const issueAge = now.getTime() - context.createdAt.getTime();
    const issueAgeMins = Math.floor(issueAge / 60000);
    const timeSinceLastResponse = context.lastResponseAt
      ? Math.floor((now.getTime() - context.lastResponseAt.getTime()) / 60000)
      : issueAgeMins;

    // Check response time SLA
    if (timeSinceLastResponse > rule.responseTimeMins) {
      return await this.executeEscalation(
        context,
        rule,
        chain[currentIdx + 1],
        `Response time SLA breached: ${timeSinceLastResponse} mins elapsed (target: ${rule.responseTimeMins} mins)`,
      );
    }

    // Check resolution time SLA
    if (issueAgeMins > rule.resolutionTimeMins) {
      return await this.executeEscalation(
        context,
        rule,
        chain[currentIdx + 1],
        `Resolution time SLA breached: ${issueAgeMins} mins elapsed (target: ${rule.resolutionTimeMins} mins)`,
      );
    }

    // Check cool-down period from last escalation
    const lastEscalation = await prisma.escalationEvent.findFirst({
      where: { issueId: context.issueId, tenantId: context.tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (lastEscalation) {
      const minsSinceLastEscalation = Math.floor(
        (now.getTime() - lastEscalation.createdAt.getTime()) / 60000,
      );

      if (minsSinceLastEscalation < rule.cooldownMins) {
        return {
          escalated: false,
          fromLevel: context.currentLevel,
          toLevel: context.currentLevel,
          reason: `Cool-down period active: ${minsSinceLastEscalation}/${rule.cooldownMins} mins`,
        };
      }
    }

    return {
      escalated: false,
      fromLevel: context.currentLevel,
      toLevel: context.currentLevel,
      reason: 'Issue within SLA, no escalation needed',
    };
  }

  /**
   * Execute an escalation: create event, send notifications, return result.
   */
  private async executeEscalation(
    context: IssueContext,
    rule: Awaited<ReturnType<EscalationService['findRule']>>,
    nextLevel: EscalationLevel,
    reason: string,
  ): Promise<EscalationResult> {
    if (!rule) {
      return {
        escalated: false,
        fromLevel: context.currentLevel,
        toLevel: context.currentLevel,
        reason: 'Rule not found for escalation',
      };
    }

    const eventId = uuidv4();

    // Record the escalation event
    await prisma.escalationEvent.create({
      data: {
        id: eventId,
        tenantId: context.tenantId,
        ruleId: rule.id,
        issueId: context.issueId,
        issueType: context.issueType,
        severity: context.severity,
        fromLevel: context.currentLevel,
        toLevel: nextLevel,
        reason,
        triggeredBy: 'system',
        notifiedAt: new Date(),
      },
    });

    // Send notifications
    await this.sendEscalationNotifications(
      context,
      rule,
      nextLevel,
      reason,
    );

    return {
      escalated: true,
      fromLevel: context.currentLevel,
      toLevel: nextLevel,
      reason,
      eventId,
    };
  }

  /**
   * Send notifications for an escalation event via configured channels.
   */
  private async sendEscalationNotifications(
    context: IssueContext,
    rule: NonNullable<Awaited<ReturnType<EscalationService['findRule']>>>,
    newLevel: EscalationLevel,
    reason: string,
  ): Promise<void> {
    const notifyChannels = rule.notifyChannels as {
      level: EscalationLevel;
      channels: string[];
    }[];

    const levelConfig = notifyChannels.find((c) => c.level === newLevel);
    const channels = levelConfig?.channels ?? ['email', 'in-app'];

    const notification: Notification = {
      id: `escalation-${context.issueId}-${newLevel}-${Date.now()}`,
      userId: 'system',
      eventType: 'escalation.triggered',
      title: `Issue Escalated to ${newLevel}`,
      body: `Issue #${context.issueId} (${context.issueType}/${context.severity}) has been escalated to ${newLevel}. Reason: ${reason}`,
      priority: context.severity === 'critical' || context.severity === 'high' ? 'high' : 'normal',
      metadata: {
        issueId: context.issueId,
        issueType: context.issueType,
        severity: context.severity,
        fromLevel: context.currentLevel,
        toLevel: newLevel,
        reason,
        tenantId: context.tenantId,
        channels,
        notifiedRoles: rule.notifyRoles,
      },
      createdAt: new Date(),
    };

    try {
      await notificationDispatcher.dispatch(notification);
      console.log(
        `[EscalationService] Notified escalation for issue ${context.issueId} to ${newLevel}`,
      );
    } catch (error) {
      console.error(
        `[EscalationService] Failed to send escalation notifications:`,
        error,
      );
    }
  }

  /**
   * Get escalation events for an issue or tenant.
   */
  async getEvents(
    tenantId: string,
    filters?: { issueId?: string; issueType?: IssueType; limit?: number },
  ) {
    const where: Record<string, unknown> = { tenantId };
    if (filters?.issueId) where.issueId = filters.issueId;
    if (filters?.issueType) where.issueType = filters.issueType;

    return prisma.escalationEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters?.limit ?? 50,
    });
  }

  /**
   * Acknowledge an escalation event.
   */
  async acknowledgeEvent(eventId: string, acknowledgedBy: string) {
    return prisma.escalationEvent.update({
      where: { id: eventId },
      data: {
        acknowledgedAt: new Date(),
        acknowledgedBy,
      },
    });
  }

  /**
   * Get a single escalation event by ID.
   */
  async getEvent(eventId: string) {
    return prisma.escalationEvent.findUnique({
      where: { id: eventId },
    });
  }
}

export const escalationService = new EscalationService();
