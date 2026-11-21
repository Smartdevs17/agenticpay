// index.ts — Issue #628
//
// Public surface of the reconciliation module: the matching engine, the
// orchestrating service singleton, and the scheduled-reconciliation entry
// point. See backend/docs/RECONCILIATION.md for the recommended cron wiring
// (`daily-payment-reconciliation`, suggested schedule `0 5 * * *`).

export {
  runMatchingEngine,
  DEFAULT_MATCHING_OPTIONS,
} from './matching-engine.js';
export type {
  MatchCandidate,
  MatchResult,
  MatchType,
  MatchingOptions,
  MatchingOutcome,
  ReconciliationSource,
} from './matching-engine.js';

export { ReconciliationService, reconciliationService } from './reconciliation-service.js';
export type {
  BatchStatus,
  ExceptionStatus,
  InternalPaymentLike,
  ExternalRecordInput,
  CreateBatchInput,
  ReconciliationRecordDTO,
  ReconciliationMatchDTO,
  ReconciliationExceptionDTO,
  ReconciliationBatchDTO,
  ReconciliationBatchDetail,
  ReconciliationReport,
  ExceptionUpdateInput,
  ExceptionListParams,
  BatchListParams,
  ReconciliationAnalytics,
} from './reconciliation-service.js';

import { reconciliationService } from './reconciliation-service.js';

/**
 * Reconcile the previous full UTC day for every tenant with `Payment`
 * activity in that window. Intended to be registered centrally as the
 * `daily-payment-reconciliation` scheduled task (see RECONCILIATION.md for
 * the suggested cron expression `0 5 * * *`). A no-op when there is no
 * tenant activity for the period.
 */
export async function runScheduledReconciliation(): Promise<void> {
  const now = new Date();
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - 1);

  const tenantIds = await reconciliationService.getTenantsWithActivity(periodStart, periodEnd);

  for (const tenantId of tenantIds) {
    try {
      const result = await reconciliationService.runBatch({
        tenantId,
        periodStart,
        periodEnd,
        externalRecords: [],
      });
      if (!result.ok) {
        console.error(`[reconciliation] scheduled batch failed for tenant ${tenantId}: ${result.error.message}`);
      }
    } catch (err) {
      console.error(`[reconciliation] scheduled batch threw for tenant ${tenantId}:`, err);
    }
  }
}
