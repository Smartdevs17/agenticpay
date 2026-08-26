// index.ts — Issue #641
//
// Public surface of the payment dispute resolution module: the pure workflow
// engine, the orchestrating service singleton, and the scheduled escalation
// entry point. See backend/docs/DISPUTE_RESOLUTION.md.

export {
  canTransition,
  nextStatus,
  isTerminal,
  statusForOutcome,
  computeDeadlines,
  shouldAutoEscalate,
  RESPONSE_SLA_HOURS,
  ESCALATION_SLA_HOURS,
  VALID_REASONS,
  VALID_OUTCOMES,
  ALL_STATUSES,
} from './workflow-engine.js';
export type {
  DisputeStatus,
  DisputeReason,
  ResolutionOutcome,
  DisputeEvent,
} from './workflow-engine.js';

export {
  DisputeResolutionService,
  disputeResolutionService,
} from './dispute-resolution-service.js';
export type {
  EvidenceDTO,
  DisputeMessageDTO,
  ResolutionRecordDTO,
  TimelineEventDTO,
  DisputeNotificationDTO,
  DisputeDTO,
  DisputeDetail,
  CreateDisputeInput,
  RespondInput,
  AddEvidenceInput,
  ResolveInput,
  ListDisputesParams,
  DisputeAnalytics,
} from './dispute-resolution-service.js';

import { disputeResolutionService } from './dispute-resolution-service.js';

/**
 * Process SLA-based auto-escalations for open disputes. Intended to be
 * registered as a scheduled task (suggested cron every 15 minutes).
 */
export async function runScheduledDisputeEscalations(): Promise<void> {
  const result = await disputeResolutionService.processEscalations();
  if (!result.ok) {
    console.error(`[dispute-resolution] escalation run failed: ${result.error.message}`);
    return;
  }
  if (result.value.escalated > 0) {
    console.log(`[dispute-resolution] auto-escalated ${result.value.escalated} dispute(s)`);
  }
}
