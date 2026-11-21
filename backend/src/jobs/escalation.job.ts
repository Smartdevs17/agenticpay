/**
 * Escalation Evaluation Job — Issue #646
 *
 * Scheduled job that periodically evaluates all open issues for SLA breaches
 * and triggers escalations when thresholds are exceeded.
 *
 * Runs every 5 minutes by default. Override with
 * SCHEDULE_OVERRIDE_ESCALATION_EVALUATION=cron-expression.
 */

import { prisma } from '../lib/prisma.js';
import { escalationService } from '../services/escalation/escalation.service.js';
import { slaTrackingService } from '../services/escalation/sla-tracking.service.js';
import type { EscalationLevel } from '../services/escalation/escalation.service.js';

export async function runEscalationEvaluation(): Promise<void> {
  console.log('[EscalationJob] Starting evaluation cycle...');

  try {
    // Find all open SLA breaches to check
    const openBreaches = await prisma.sLABreach.findMany({
      where: {
        status: 'breached',
      },
      select: {
        id: true,
        tenantId: true,
        issueId: true,
        issueType: true,
        severity: true,
        breachType: true,
        createdAt: true,
      },
    });

    console.log(`[EscalationJob] Found ${openBreaches.length} open breaches`);

    let escalatedCount = 0;
    let breachCount = 0;

    for (const breach of openBreaches) {
      try {
        // Determine current escalation level from the most recent escalation event
        const lastEvent = await prisma.escalationEvent.findFirst({
          where: { issueId: breach.issueId, tenantId: breach.tenantId },
          orderBy: { createdAt: 'desc' },
          select: { toLevel: true },
        });

        const currentLevel: EscalationLevel = (lastEvent?.toLevel as EscalationLevel) || 'level_1';

        // Evaluate escalation for each breached issue
        const result = await escalationService.evaluateEscalation({
          issueId: breach.issueId,
          tenantId: breach.tenantId,
          issueType: breach.issueType as any,
          severity: breach.severity as any,
          currentLevel,
          createdAt: breach.createdAt,
        });

        if (result.escalated) {
          escalatedCount++;
          console.log(
            `[EscalationJob] Escalated issue ${breach.issueId}: ${result.fromLevel} → ${result.toLevel}`,
          );
        }

        // Re-check SLA
        const slaResult = await slaTrackingService.checkSLA(
          breach.tenantId,
          breach.issueId,
          breach.issueType as any,
          breach.severity as any,
          { createdAt: breach.createdAt },
        );

        if (slaResult.breached) {
          breachCount++;
        }
      } catch (err) {
        console.error(
          `[EscalationJob] Error processing breach ${breach.id}:`,
          err,
        );
      }
    }

    // Aggregate analytics for all tenants with breaches
    const tenantIds = [...new Set(openBreaches.map((b) => b.tenantId))];
    for (const tenantId of tenantIds) {
      try {
        await slaTrackingService.aggregateAnalytics(tenantId);
      } catch (err) {
        console.error(
          `[EscalationJob] Error aggregating analytics for tenant ${tenantId}:`,
          err,
        );
      }
    }

    console.log(
      `[EscalationJob] Cycle complete: ${escalatedCount} escalated, ${breachCount} breaches detected`,
    );
  } catch (error) {
    console.error('[EscalationJob] Fatal error in evaluation cycle:', error);
  }
}

/**
 * Seed default rules for tenants that don't have any escalation rules yet.
 */
export async function ensureDefaultRulesForTenants(): Promise<void> {
  try {
    const tenants = await prisma.user.findMany({
      select: { tenantId: true },
      distinct: ['tenantId'],
    });

    for (const { tenantId } of tenants) {
      await escalationService.seedDefaultRules(tenantId);
    }
  } catch (error) {
    console.error('[EscalationJob] Error seeding default rules:', error);
  }
}
