/**
 * paymentRetry.ts — Issue #592
 *
 * Intelligent payment retry engine with failure categorisation, exponential
 * back-off scheduling, payment-method fallback chains, dunning email sequences,
 * and account-suspension after prolonged failure.
 */

import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService.js';
import type { Result } from '../lib/result.js';

// ── Failure categorisation ────────────────────────────────────────────────────

export type FailureCategory =
  | 'INSUFFICIENT_FUNDS'
  | 'CARD_EXPIRED'
  | 'CARD_DECLINED'
  | 'NETWORK_ERROR'
  | 'FRAUD_SUSPECTED'
  | 'INVALID_DETAILS'
  | 'PROCESSOR_ERROR'
  | 'UNKNOWN';

export type RetrySeverity = 'immediate' | 'same_day' | 'next_day' | 'weekly' | 'abandon';

export interface FailureInfo {
  category: FailureCategory;
  severity: RetrySeverity;
  retryable: boolean;
  resolutionSuggestions: string[];
  dunningMessage: string;
}

export type RetryStatus =
  | 'pending'
  | 'scheduled'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'abandoned';

export interface PaymentAttempt {
  id: string;
  attemptNumber: number;
  scheduledAt: string;
  executedAt?: string;
  status: 'pending' | 'succeeded' | 'failed';
  failureCategory?: FailureCategory;
  failureMessage?: string;
  paymentMethodId: string;
}

export interface RetryRecord {
  id: string;
  paymentId: string;
  userId: string;
  originalAmount: number;
  currency: string;
  status: RetryStatus;
  attempts: PaymentAttempt[];
  currentAttemptNumber: number;
  maxAttempts: number;
  nextRetryAt?: string;
  abandonedAt?: string;
  suspendAccountAt?: string;
  dunningStep: number;
  paymentMethodFallbackChain: string[];
  currentPaymentMethodIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRetryInput {
  paymentId: string;
  userId: string;
  amount: number;
  currency: string;
  failureReason: string;
  paymentMethodIds: string[]; // ordered fallback chain
}

export interface RetryStats {
  total: number;
  pending: number;
  scheduled: number;
  succeeded: number;
  failed: number;
  abandoned: number;
  recoveryRate: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS_DEFAULT = 7;
const SUSPENSION_THRESHOLD_DAYS = 30;

const CATEGORY_MAP: Record<string, FailureInfo> = {
  insufficient_funds: {
    category: 'INSUFFICIENT_FUNDS',
    severity: 'next_day',
    retryable: true,
    resolutionSuggestions: [
      'Add funds to your account or linked bank account.',
      'Update to a card with sufficient balance.',
      'Consider splitting this payment into smaller amounts.',
    ],
    dunningMessage: 'Your payment failed due to insufficient funds. Please add funds or update your payment method.',
  },
  expired: {
    category: 'CARD_EXPIRED',
    severity: 'abandon',
    retryable: false,
    resolutionSuggestions: [
      'Update your card details with the new expiry date.',
      'Add a new payment method.',
    ],
    dunningMessage: 'Your card has expired. Please update your payment details to continue.',
  },
  declined: {
    category: 'CARD_DECLINED',
    severity: 'same_day',
    retryable: true,
    resolutionSuggestions: [
      'Contact your bank to authorise the transaction.',
      'Try a different payment method.',
      'Ensure your billing address matches your card details.',
    ],
    dunningMessage: 'Your card was declined. Please contact your bank or try a different card.',
  },
  network: {
    category: 'NETWORK_ERROR',
    severity: 'immediate',
    retryable: true,
    resolutionSuggestions: ['The system will automatically retry. No action required.'],
    dunningMessage: 'A temporary network error occurred. We are retrying your payment automatically.',
  },
  fraud: {
    category: 'FRAUD_SUSPECTED',
    severity: 'abandon',
    retryable: false,
    resolutionSuggestions: [
      'Contact your bank to verify recent transactions.',
      'Use a verified payment method.',
    ],
    dunningMessage: 'Your payment was flagged for security review. Please contact support.',
  },
  invalid: {
    category: 'INVALID_DETAILS',
    severity: 'abandon',
    retryable: false,
    resolutionSuggestions: [
      'Double-check your card number, expiry, and CVV.',
      'Update your billing address.',
    ],
    dunningMessage: 'Invalid payment details detected. Please update your payment information.',
  },
  processor: {
    category: 'PROCESSOR_ERROR',
    severity: 'next_day',
    retryable: true,
    resolutionSuggestions: ['Our payment processor experienced an issue. We will retry automatically.'],
    dunningMessage: 'A temporary processing error occurred. We will retry your payment tomorrow.',
  },
};

// ── Retry delay schedule (ms) ────────────────────────────────────────────────

const RETRY_DELAYS: Record<RetrySeverity, number> = {
  immediate: 5 * 60 * 1_000,           // 5 minutes
  same_day: 4 * 60 * 60 * 1_000,       // 4 hours
  next_day: 24 * 60 * 60 * 1_000,      // 24 hours
  weekly: 7 * 24 * 60 * 60 * 1_000,    // 7 days
  abandon: 0,
};

// ── In-memory store ──────────────────────────────────────────────────────────

const retryRecords = new Map<string, RetryRecord>();        // id → record
const byPayment = new Map<string, string>();                 // paymentId → retryId
const byUser = new Map<string, Set<string>>();               // userId → retryIds

// ── Service ──────────────────────────────────────────────────────────────────

export class PaymentRetryService extends BaseService {

  // ── Categorise a failure reason string ────────────────────────────────────

  categoriseFailure(reason: string): FailureInfo {
    const lower = reason.toLowerCase();
    for (const [key, info] of Object.entries(CATEGORY_MAP)) {
      if (lower.includes(key)) {
        return info;
      }
    }
    return {
      category: 'UNKNOWN',
      severity: 'next_day',
      retryable: true,
      resolutionSuggestions: ['Please contact support if this issue persists.'],
      dunningMessage: 'Your payment could not be processed. Please try again or contact support.',
    };
  }

  // ── Create a new retry record ──────────────────────────────────────────────

  createRetry(input: CreateRetryInput): Result<RetryRecord> {
    if (byPayment.has(input.paymentId)) {
      const existing = retryRecords.get(byPayment.get(input.paymentId)!)!;
      if (['pending', 'scheduled', 'in_progress'].includes(existing.status)) {
        return this.conflictFailure(
          `An active retry already exists for payment ${input.paymentId}`,
        );
      }
    }

    if (input.paymentMethodIds.length === 0) {
      return this.validationFailure('At least one payment method is required');
    }

    const failureInfo = this.categoriseFailure(input.failureReason);
    const now = new Date();
    const id = randomUUID();

    let nextRetryAt: string | undefined;
    let status: RetryStatus = 'scheduled';

    if (!failureInfo.retryable) {
      status = 'abandoned';
    } else {
      const delay = RETRY_DELAYS[failureInfo.severity];
      nextRetryAt = new Date(now.getTime() + delay).toISOString();
    }

    const suspendAt = new Date(now.getTime() + SUSPENSION_THRESHOLD_DAYS * 24 * 60 * 60 * 1_000);

    const record: RetryRecord = {
      id,
      paymentId: input.paymentId,
      userId: input.userId,
      originalAmount: input.amount,
      currency: input.currency,
      status,
      attempts: [],
      currentAttemptNumber: 0,
      maxAttempts: MAX_ATTEMPTS_DEFAULT,
      nextRetryAt,
      suspendAccountAt: suspendAt.toISOString(),
      dunningStep: 0,
      paymentMethodFallbackChain: [...input.paymentMethodIds],
      currentPaymentMethodIndex: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    retryRecords.set(id, record);
    byPayment.set(input.paymentId, id);

    const userSet = byUser.get(input.userId) ?? new Set<string>();
    userSet.add(id);
    byUser.set(input.userId, userSet);

    return this.ok(record);
  }

  // ── Execute the next retry attempt ────────────────────────────────────────

  executeRetry(
    retryId: string,
    options?: { forceMethodIndex?: number },
  ): Result<PaymentAttempt> {
    const record = retryRecords.get(retryId);
    if (!record) return this.notFoundFailure('RetryRecord', retryId);
    if (record.status === 'abandoned') {
      return this.validationFailure('Cannot retry an abandoned payment');
    }
    if (record.status === 'succeeded') {
      return this.validationFailure('Payment already succeeded');
    }
    if (record.currentAttemptNumber >= record.maxAttempts) {
      this.abandonRetry(retryId);
      return this.validationFailure('Maximum retry attempts reached');
    }

    const methodIndex = options?.forceMethodIndex ?? record.currentPaymentMethodIndex;
    const paymentMethodId = record.paymentMethodFallbackChain[methodIndex];

    const attempt: PaymentAttempt = {
      id: randomUUID(),
      attemptNumber: record.currentAttemptNumber + 1,
      scheduledAt: record.nextRetryAt ?? new Date().toISOString(),
      executedAt: new Date().toISOString(),
      status: 'pending',
      paymentMethodId,
    };

    record.attempts.push(attempt);
    record.currentAttemptNumber++;
    record.status = 'in_progress';
    record.updatedAt = new Date().toISOString();
    retryRecords.set(retryId, record);

    return this.ok(attempt);
  }

  // ── Record the outcome of an attempt ──────────────────────────────────────

  recordAttemptOutcome(
    retryId: string,
    attemptId: string,
    outcome: { success: boolean; failureReason?: string },
  ): Result<RetryRecord> {
    const record = retryRecords.get(retryId);
    if (!record) return this.notFoundFailure('RetryRecord', retryId);

    const attempt = record.attempts.find((a) => a.id === attemptId);
    if (!attempt) return this.notFoundFailure('PaymentAttempt', attemptId);

    attempt.status = outcome.success ? 'succeeded' : 'failed';

    if (outcome.success) {
      record.status = 'succeeded';
      record.nextRetryAt = undefined;
    } else if (outcome.failureReason) {
      const failureInfo = this.categoriseFailure(outcome.failureReason);
      attempt.failureCategory = failureInfo.category;
      attempt.failureMessage = outcome.failureReason;

      // Advance dunning step
      record.dunningStep = Math.min(record.dunningStep + 1, 5);

      if (!failureInfo.retryable || record.currentAttemptNumber >= record.maxAttempts) {
        record.status = 'abandoned';
        record.abandonedAt = new Date().toISOString();
      } else {
        // Try fallback payment method if available
        const nextMethodIndex = record.currentPaymentMethodIndex + 1;
        const hasNextMethod = nextMethodIndex < record.paymentMethodFallbackChain.length;

        if (hasNextMethod && !failureInfo.retryable) {
          record.currentPaymentMethodIndex = nextMethodIndex;
        }

        const delay = RETRY_DELAYS[failureInfo.severity];
        record.nextRetryAt = new Date(Date.now() + delay).toISOString();
        record.status = 'scheduled';
      }
    }

    record.updatedAt = new Date().toISOString();
    retryRecords.set(retryId, record);

    return this.ok(record);
  }

  // ── Abandon a retry manually ───────────────────────────────────────────────

  abandonRetry(retryId: string): Result<RetryRecord> {
    const record = retryRecords.get(retryId);
    if (!record) return this.notFoundFailure('RetryRecord', retryId);
    if (record.status === 'succeeded') {
      return this.validationFailure('Cannot abandon a succeeded payment');
    }

    record.status = 'abandoned';
    record.abandonedAt = new Date().toISOString();
    record.nextRetryAt = undefined;
    record.updatedAt = new Date().toISOString();
    retryRecords.set(retryId, record);

    return this.ok(record);
  }

  // ── Get retry by id ───────────────────────────────────────────────────────

  getRetry(retryId: string): Result<RetryRecord> {
    const record = retryRecords.get(retryId);
    if (!record) return this.notFoundFailure('RetryRecord', retryId);
    return this.ok(record);
  }

  // ── Get retry by paymentId ────────────────────────────────────────────────

  getRetryByPayment(paymentId: string): Result<RetryRecord> {
    const id = byPayment.get(paymentId);
    if (!id) return this.notFoundFailure('RetryRecord', paymentId);
    return this.getRetry(id);
  }

  // ── List retries for a user ───────────────────────────────────────────────

  listUserRetries(userId: string): RetryRecord[] {
    const ids = byUser.get(userId) ?? new Set<string>();
    return Array.from(ids)
      .map((id) => retryRecords.get(id)!)
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // ── List retries due for execution ────────────────────────────────────────

  getDueRetries(): RetryRecord[] {
    const now = new Date().toISOString();
    return Array.from(retryRecords.values()).filter(
      (r) => r.status === 'scheduled' && r.nextRetryAt && r.nextRetryAt <= now,
    );
  }

  // ── Statistics ────────────────────────────────────────────────────────────

  getStats(): RetryStats {
    const all = Array.from(retryRecords.values());
    const total = all.length;
    const byStatus = {
      pending: all.filter((r) => r.status === 'pending').length,
      scheduled: all.filter((r) => r.status === 'scheduled').length,
      in_progress: all.filter((r) => r.status === 'in_progress').length,
      succeeded: all.filter((r) => r.status === 'succeeded').length,
      failed: all.filter((r) => r.status === 'failed').length,
      abandoned: all.filter((r) => r.status === 'abandoned').length,
    };
    const recoverable = byStatus.succeeded + byStatus.abandoned;
    const recoveryRate = recoverable > 0 ? (byStatus.succeeded / recoverable) * 100 : 0;

    return {
      total,
      pending: byStatus.pending,
      scheduled: byStatus.scheduled + byStatus.in_progress,
      succeeded: byStatus.succeeded,
      failed: byStatus.failed,
      abandoned: byStatus.abandoned,
      recoveryRate: parseFloat(recoveryRate.toFixed(2)),
    };
  }

  // ── Check accounts due for suspension ────────────────────────────────────

  getAccountsDueForSuspension(): Array<{ userId: string; retryIds: string[] }> {
    const now = new Date().toISOString();
    const suspensionMap = new Map<string, string[]>();

    for (const record of retryRecords.values()) {
      if (
        record.status === 'scheduled' &&
        record.suspendAccountAt &&
        record.suspendAccountAt <= now
      ) {
        const arr = suspensionMap.get(record.userId) ?? [];
        arr.push(record.id);
        suspensionMap.set(record.userId, arr);
      }
    }

    return Array.from(suspensionMap.entries()).map(([userId, retryIds]) => ({
      userId,
      retryIds,
    }));
  }
}

export const paymentRetryService = new PaymentRetryService();
