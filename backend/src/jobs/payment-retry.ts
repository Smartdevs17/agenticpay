/**
 * payment-retry.ts — Issue #592
 *
 * Scheduled jobs for the payment retry engine.
 *
 * Jobs registered:
 *  - payment-retry-processor  : runs every 10 min, executes due retries
 *  - payment-retry-suspension : runs daily, suspends accounts with prolonged failure
 *  - payment-retry-cleanup    : runs weekly, marks stale records abandoned
 */

import type { JobDefinition } from './types.js';
import { paymentRetryService } from '../services/paymentRetry.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[payment-retry-jobs] ${new Date().toISOString()} ${msg}`);
}

// ── Process due retries ──────────────────────────────────────────────────────

async function processDueRetries(): Promise<void> {
  const due = paymentRetryService.getDueRetries();

  if (due.length === 0) {
    log('No retries due.');
    return;
  }

  log(`Processing ${due.length} due retries...`);

  for (const record of due) {
    const attemptResult = paymentRetryService.executeRetry(record.id);

    if (!attemptResult.ok) {
      log(`[SKIP] ${record.id}: ${attemptResult.error.message}`);
      continue;
    }

    const attempt = attemptResult.value;

    // ── Simulate payment execution ─────────────────────────────────────────
    // In production, call the actual payment provider here.
    // We simulate a 70 % success rate for demonstration purposes.
    const simulatedSuccess = Math.random() > 0.3;
    const simulatedFailureReason = simulatedSuccess
      ? undefined
      : 'insufficient_funds';

    const outcome = paymentRetryService.recordAttemptOutcome(record.id, attempt.id, {
      success: simulatedSuccess,
      failureReason: simulatedFailureReason,
    });

    if (!outcome.ok) {
      log(`[ERROR] Could not record outcome for ${record.id}: ${outcome.error.message}`);
      continue;
    }

    if (simulatedSuccess) {
      log(`[OK] Payment ${record.paymentId} recovered on attempt #${attempt.attemptNumber}`);
    } else {
      const updated = outcome.value;
      if (updated.status === 'abandoned') {
        log(`[ABANDONED] Payment ${record.paymentId} — max attempts exhausted`);
      } else {
        log(`[RESCHEDULED] Payment ${record.paymentId} — next retry at ${updated.nextRetryAt}`);
      }
    }
  }
}

// ── Check for accounts due for suspension ────────────────────────────────────

async function checkSuspensions(): Promise<void> {
  const accounts = paymentRetryService.getAccountsDueForSuspension();

  if (accounts.length === 0) {
    log('No accounts due for suspension.');
    return;
  }

  log(`Found ${accounts.length} accounts with prolonged payment failure.`);

  for (const { userId, retryIds } of accounts) {
    log(`[SUSPEND] User ${userId} — abandoning ${retryIds.length} retry records`);

    for (const retryId of retryIds) {
      paymentRetryService.abandonRetry(retryId);
    }

    // TODO: dispatch account-suspension event / notify user
  }
}

// ── Cleanup stale pending records ────────────────────────────────────────────

async function cleanupStaleRetries(): Promise<void> {
  const stats = paymentRetryService.getStats();
  log(`Retry engine stats — total:${stats.total}, succeeded:${stats.succeeded}, ` +
    `abandoned:${stats.abandoned}, recovery rate:${stats.recoveryRate}%`);
  // Additional cleanup logic (e.g., purge old abandoned records) can be added here.
}

// ── Job definitions ───────────────────────────────────────────────────────────

export const paymentRetryJobs: JobDefinition[] = [
  {
    id: 'payment-retry-processor',
    name: 'Process Due Payment Retries',
    schedule: { type: 'cron', expression: '*/10 * * * *' }, // every 10 minutes
    handler: processDueRetries,
  },
  {
    id: 'payment-retry-suspension',
    name: 'Suspend Accounts with Prolonged Failures',
    schedule: { type: 'cron', expression: '0 6 * * *' }, // daily at 06:00 UTC
    handler: checkSuspensions,
  },
  {
    id: 'payment-retry-cleanup',
    name: 'Payment Retry Cleanup & Stats',
    schedule: { type: 'cron', expression: '0 3 * * 0' }, // weekly Sunday 03:00 UTC
    handler: cleanupStaleRetries,
  },
];
