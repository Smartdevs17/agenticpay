import { randomUUID } from 'node:crypto';
import { quantizeNumber } from '../money.js';
import {
  moneyMovementAuditLog,
  type MoneyMovementAuditLog,
  type MoneyMovementOperation,
} from '../../audit/money-movement-audit.js';
import { payoutAnomalyDetector, type PayoutAnomalyDetector } from './payout-anomaly-detector.js';

export const DEFAULT_PAYOUT_APPROVAL_THRESHOLD = 10_000;

/** Attempts a batch is given before it is treated as permanently failed. */
export const DEFAULT_PAYOUT_MAX_ATTEMPTS = 5;

/** First retry delay; doubles per attempt up to `PAYOUT_RETRY_MAX_MS`. */
export const PAYOUT_RETRY_BASE_MS = 30_000;
export const PAYOUT_RETRY_MAX_MS = 60 * 60 * 1000;

/** Fraction of the computed delay used as random jitter, to avoid retry stampedes. */
export const PAYOUT_RETRY_JITTER_RATIO = 0.25;

/**
 * Assets payouts may be denominated in. Anything else has to be added deliberately
 * rather than by whatever value reaches the schedule configuration call.
 */
export const SUPPORTED_PAYOUT_ASSETS = Object.freeze(['USDC', 'USDT', 'XLM', 'EURC'] as const);
export type PayoutAsset = (typeof SUPPORTED_PAYOUT_ASSETS)[number];

/** Minor-unit decimals per supported payout asset. */
export const PAYOUT_ASSET_DECIMALS: Readonly<Record<PayoutAsset, number>> = Object.freeze({
  USDC: 6,
  USDT: 6,
  XLM: 7,
  EURC: 6,
});

/** Fallback scale for an asset with no entry above; unused for allowlisted assets. */
export const DEFAULT_PAYOUT_ASSET_DECIMALS = 6;

/** Engine-level ceiling on a single batch, independent of any approver's limit. */
export const DEFAULT_PAYOUT_MAX_BATCH_AMOUNT = 1_000_000;

export type PayoutApproverRole = 'finance_approver' | 'admin';

export interface PayoutApprover {
  id: string;
  role: PayoutApproverRole;
}

export type PayoutScheduleType = 'daily' | 'weekly' | 'monthly' | 'threshold';

export interface PayoutSchedule {
  id: string;
  merchantId: string;
  scheduleType: PayoutScheduleType;
  thresholdAmount?: number;
  preferredAsset: string;
  autoApproveLimit: number;
}

export type PayoutStatus = 'pending' | 'executing' | 'completed' | 'failed';

export interface PayoutBatch {
  id: string;
  /** Stable key handed to the executor so a rail can deduplicate a replayed batch. */
  idempotencyKey: string;
  merchantId: string;
  scheduleId: string;
  /** Identifies the payout cycle a batch belongs to; one batch per cycle per schedule. */
  cycleKey: string;
  status: PayoutStatus;
  amount: number;
  asset: string;
  transactionsCount: number;
  errorMessage?: string;
  errorCode?: string;
  rejectedBy?: string;
  attempts: number;
  maxAttempts: number;
  /** True when the batch must clear human review before it may settle. */
  requiresApproval: boolean;
  nextAttemptAt?: Date;
  settledAt?: Date;
  transactionHash?: string;
  /** True once the batch's amount has been returned to the merchant's pending balance. */
  fundsReleased: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayoutAuditEntry {
  batchId: string;
  action: 'created' | 'approved' | 'rejected' | 'retried' | 'executing' | 'settled' | 'failed' | 'released';
  actorId: string;
  timestamp: Date;
  details?: string;
}

export type PayoutEventType =
  | 'payout.created'
  | 'payout.pending_review'
  | 'payout.executing'
  | 'payout.completed'
  | 'payout.failed'
  | 'payout.delayed';

export interface PayoutEvent {
  type: PayoutEventType;
  batchId: string;
  merchantId: string;
  amount: number;
  asset: string;
  attempt: number;
  at: Date;
  detail?: string;
}

/** Work handed to the settlement rail for one batch. */
export interface PayoutExecutionRequest {
  batchId: string;
  idempotencyKey: string;
  merchantId: string;
  asset: string;
  amount: number;
  attempt: number;
}

export interface PayoutExecutionResult {
  transactionHash: string;
  settledAt?: Date;
}

/** Settles a batch. Rejecting marks the attempt failed and schedules a retry. */
export type PayoutExecutor = (request: PayoutExecutionRequest) => Promise<PayoutExecutionResult>;

export type PayoutEventSink = (event: PayoutEvent) => void;

export interface PayoutEngineOptions {
  /** Payouts at or above this amount always need an approver. Defaults to PAYOUT_APPROVAL_THRESHOLD or 10,000. */
  approvalThreshold?: number;
  /** Attempts per batch before it is permanently failed. Defaults to 5. */
  maxAttempts?: number;
  /** First retry delay in ms. Defaults to 30s. */
  retryBaseMs?: number;
  /** Upper bound for a retry delay in ms. Defaults to 1h. */
  retryMaxMs?: number;
  /** Upper bound for a single batch. Defaults to 1,000,000. */
  maxBatchAmount?: number;
  /** Assets payouts may use. Defaults to SUPPORTED_PAYOUT_ASSETS. */
  allowedAssets?: readonly string[];
  /** Settlement rail. Defaults to a local no-network executor. */
  executor?: PayoutExecutor;
  /** Receives every lifecycle event; wire this to webhooks/metrics in production. */
  onEvent?: PayoutEventSink;
  /** Injectable randomness for retry jitter. */
  random?: () => number;
  /** Tamper-evident log every money movement is written to (#1011). */
  auditLog?: MoneyMovementAuditLog;
  /**
   * Scores each new batch (#1013). A flagged batch always needs approval, and cannot be
   * approved until its flags have been reviewed.
   */
  anomalyDetector?: PayoutAnomalyDetector;
  /** Clock injection point for tests. */
  now?: () => Date;
}

const APPROVER_ROLES: readonly PayoutApproverRole[] = ['finance_approver', 'admin'];

const MAX_ID_LENGTH = 128;

/** The only transitions the engine permits. Anything else is a programming error. */
const ALLOWED_TRANSITIONS: Readonly<Record<PayoutStatus, readonly PayoutStatus[]>> = Object.freeze({
  pending: Object.freeze(['executing', 'completed', 'failed'] as const),
  executing: Object.freeze(['completed', 'failed'] as const),
  completed: Object.freeze([] as const),
  failed: Object.freeze(['pending'] as const),
});

const SCHEDULE_PERIOD_MS: Readonly<Record<PayoutScheduleType, number | null>> = Object.freeze({
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  threshold: null,
});

/**
 * Default executor. It performs no network I/O: it exists so the engine has a real
 * `pending -> executing -> completed` path and so tests can inject failures. A
 * deployment must supply an executor bound to the actual settlement rail.
 */
const defaultExecutor: PayoutExecutor = async (request) => ({
  transactionHash: `po_exec_${request.idempotencyKey}`,
  settledAt: undefined,
});

function snapshotBatch(batch: PayoutBatch): PayoutBatch {
  return {
    ...batch,
    nextAttemptAt: batch.nextAttemptAt ? new Date(batch.nextAttemptAt) : undefined,
    settledAt: batch.settledAt ? new Date(batch.settledAt) : undefined,
    createdAt: new Date(batch.createdAt),
    updatedAt: new Date(batch.updatedAt),
  };
}

function snapshotAuditEntry(entry: PayoutAuditEntry): PayoutAuditEntry {
  return { ...entry, timestamp: new Date(entry.timestamp) };
}

function resolveApprovalThreshold(explicit?: number): number {
  const fromEnv = Number(process.env.PAYOUT_APPROVAL_THRESHOLD);
  const threshold = explicit ?? (fromEnv > 0 ? fromEnv : DEFAULT_PAYOUT_APPROVAL_THRESHOLD);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error('INVALID_PAYOUT_APPROVAL_THRESHOLD');
  }
  return threshold;
}

function resolvePositiveLimit(value: number | undefined, fallback: number, code: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
  return value;
}

function assetDecimals(asset: string): number {
  const decimals = (PAYOUT_ASSET_DECIMALS as Record<string, number | undefined>)[asset];
  return decimals ?? DEFAULT_PAYOUT_ASSET_DECIMALS;
}

export class PayoutEngine {
  private schedules: PayoutSchedule[] = [];
  private batches: PayoutBatch[] = [];
  private auditTrail: PayoutAuditEntry[] = [];
  private pendingAmounts: Map<string, number> = new Map(); // merchantId -> amount
  private lastMaterialisedAt: Map<string, number> = new Map(); // scheduleId -> epoch ms
  /** Cycle keys already materialised, so a replayed evaluation cannot settle a cycle twice. */
  private materialisedCycles: Map<string, string> = new Map(); // cycleKey -> batchId
  /** Guards against two overlapping `evaluatePayouts` passes settling the same cycle. */
  private evaluationInFlight = false;
  private sequence = 0;

  readonly approvalThreshold: number;
  readonly maxAttempts: number;
  readonly maxBatchAmount: number;
  readonly allowedAssets: readonly string[];

  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly executor: PayoutExecutor;
  private readonly onEvent?: PayoutEventSink;
  private readonly auditLog?: MoneyMovementAuditLog;
  private readonly anomalyDetector?: PayoutAnomalyDetector;
  private readonly random: () => number;
  private readonly now: () => Date;

  constructor(options: PayoutEngineOptions = {}) {
    this.approvalThreshold = resolveApprovalThreshold(options.approvalThreshold);
    this.maxAttempts = Math.max(
      1,
      Math.floor(resolvePositiveLimit(options.maxAttempts, DEFAULT_PAYOUT_MAX_ATTEMPTS, 'INVALID_PAYOUT_MAX_ATTEMPTS')),
    );
    this.maxBatchAmount = resolvePositiveLimit(
      options.maxBatchAmount,
      DEFAULT_PAYOUT_MAX_BATCH_AMOUNT,
      'INVALID_PAYOUT_MAX_BATCH_AMOUNT',
    );
    this.retryBaseMs = resolvePositiveLimit(options.retryBaseMs, PAYOUT_RETRY_BASE_MS, 'INVALID_PAYOUT_RETRY_BASE_MS');
    this.retryMaxMs = Math.max(
      this.retryBaseMs,
      resolvePositiveLimit(options.retryMaxMs, PAYOUT_RETRY_MAX_MS, 'INVALID_PAYOUT_RETRY_MAX_MS'),
    );
    this.allowedAssets = Object.freeze([...(options.allowedAssets ?? SUPPORTED_PAYOUT_ASSETS)]);
    if (this.allowedAssets.length === 0) throw new Error('INVALID_PAYOUT_ALLOWED_ASSETS');

    this.executor = options.executor ?? defaultExecutor;
    this.onEvent = options.onEvent;
    this.auditLog = options.auditLog;
    this.anomalyDetector = options.anomalyDetector;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
  }

  /** Clears every schedule, batch, audit entry and balance. Intended for tests. */
  reset(): void {
    this.schedules = [];
    this.batches = [];
    this.auditTrail = [];
    this.pendingAmounts.clear();
    this.lastMaterialisedAt.clear();
    this.materialisedCycles.clear();
    this.sequence = 0;
  }

  setPendingAmount(merchantId: string, amount: number, actorId = 'system') {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('INVALID_PENDING_PAYOUT_AMOUNT');
    }
    const previous = this.getPendingAmount(merchantId);
    this.pendingAmounts.set(merchantId, amount);
    this.auditLog?.record({
      actor: actorId,
      operation: 'balance.set',
      amount,
      asset: this.schedules.find((s) => s.merchantId === merchantId)?.preferredAsset ?? 'unspecified',
      reference: `balance:${merchantId}`,
      merchantId,
      metadata: { previousAmount: previous },
    });
  }

  getPendingAmount(merchantId: string): number {
    return this.pendingAmounts.get(merchantId) || 0;
  }

  configureSchedule(schedule: PayoutSchedule) {
    this.assertValidSchedule(schedule);
    this.schedules = this.schedules.filter((s) => s.merchantId !== schedule.merchantId);
    this.schedules.push({ ...schedule });
  }

  /** Removes a merchant's schedule and forgets its cycle history. */
  removeSchedule(merchantId: string): boolean {
    const removed = this.schedules.find((s) => s.merchantId === merchantId);
    if (!removed) return false;
    this.schedules = this.schedules.filter((s) => s.merchantId !== merchantId);
    this.lastMaterialisedAt.delete(removed.id);
    return true;
  }

  /**
   * Runs one payout pass. Safe to call on a timer and safe to call twice concurrently:
   * a batch's amount is reserved when the batch is created, and each calendar cycle can
   * only ever materialise one batch.
   *
   * A single merchant's misconfiguration is isolated: one failing schedule is recorded
   * against the audit trail and the pass continues with the remaining schedules.
   */
  async evaluatePayouts(): Promise<PayoutBatch[]> {
    if (this.evaluationInFlight) return [];
    this.evaluationInFlight = true;

    try {
      const executedBatches: PayoutBatch[] = [];

      for (const schedule of this.schedules) {
        try {
          const created = await this.materialiseBatch(schedule);
          if (!created) continue;
          executedBatches.push(created);
        } catch (error) {
          // Pre-batch failures are recorded against the schedule id; a rejected batch
          // must never block the payouts of every other merchant in the same pass.
          const detail = error instanceof Error ? error.message : 'Unknown payout scheduling error';
          this.record(schedule.id, 'failed', 'system', detail);
        }
      }

      return executedBatches;
    } finally {
      this.evaluationInFlight = false;
    }
  }

  /** Returns the batch a schedule produced this pass, or `undefined` when nothing is due. */
  private async materialiseBatch(schedule: PayoutSchedule): Promise<PayoutBatch | undefined> {
    if (!this.isScheduleDue(schedule)) return undefined;

    const pending = this.getPendingAmount(schedule.merchantId);
    if (!this.isTriggerMet(schedule, pending)) return undefined;

    const cycleKey = this.cycleKeyFor(schedule);
    // Calendar schedules are additionally guarded by their period bucket, so a replayed
    // evaluation pass cannot settle the same period twice. Threshold schedules rely on
    // the reservation instead: new funds legitimately form a new cycle on the same day.
    if (this.isCalendarSchedule(schedule) && this.materialisedCycles.has(cycleKey)) return undefined;

    const { batch, requiresApproval } = this.createBatch(schedule, pending, cycleKey);
    this.materialisedCycles.set(cycleKey, batch.id);
    this.lastMaterialisedAt.set(schedule.id, this.now().getTime());

    if (requiresApproval) {
      this.record(batch.id, 'created', 'system', 'Awaiting approval');
      this.emit('payout.pending_review', batch, 'Awaiting approval');
    } else {
      // Auto-approved: settle immediately rather than queueing for review.
      await this.settle(batch, 'system');
    }

    return snapshotBatch(batch);
  }

  /**
   * Retries every failed batch whose backoff has elapsed and whose attempts remain.
   *
   * Auto-approved batches are re-settled by the worker. Batches that owed human review
   * are returned to the approval queue instead, so a retry can never skip the review
   * that the amount size demanded.
   */
  async retryDueBatches(): Promise<PayoutBatch[]> {
    const due = this.batches.filter(
      (batch) =>
        batch.status === 'failed' &&
        !batch.rejectedBy &&
        batch.attempts < batch.maxAttempts &&
        batch.nextAttemptAt !== undefined &&
        batch.nextAttemptAt.getTime() <= this.now().getTime(),
    );

    const retried: PayoutBatch[] = [];
    for (const batch of due) {
      delete batch.nextAttemptAt;
      delete batch.errorCode;
      delete batch.errorMessage;
      this.transition(batch, 'pending');
      this.record(batch.id, 'retried', 'system', 'Retry after backoff elapsed');

      if (batch.requiresApproval) {
        this.emit('payout.pending_review', batch, 'Awaiting re-approval after failure');
      } else {
        await this.settle(batch, 'system');
      }

      retried.push(snapshotBatch(batch));
    }

    return retried;
  }

  async approveManualPayout(batchId: string, approver: PayoutApprover): Promise<boolean> {
    this.assertApprover(approver);
    const batch = this.batches.find((b) => b.id === batchId);
    if (!batch || batch.status !== 'pending') return false;
    // A flagged batch must have its anomaly flags reviewed before anyone can push it through.
    if (this.anomalyDetector?.hasOpenFlags(batch.id)) throw new Error('PAYOUT_ANOMALY_REVIEW_PENDING');

    this.record(batch.id, 'approved', approver.id);
    this.audit('payout.approved', batch, approver.id);
    await this.settle(batch, approver.id);
    return true;
  }

  async rejectManualPayout(batchId: string, approver: PayoutApprover): Promise<boolean> {
    this.assertApprover(approver);
    const batch = this.batches.find((b) => b.id === batchId);
    if (!batch || batch.status !== 'pending') return false;

    this.transition(batch, 'failed');
    batch.errorMessage = 'Rejected by manual review';
    batch.rejectedBy = approver.id;
    this.audit('payout.rejected', batch, approver.id);
    // Return the reserved funds to the merchant's pending balance.
    this.releaseFunds(batch, approver.id);
    this.record(batch.id, 'rejected', approver.id, batch.errorMessage);
    this.emit('payout.failed', batch, batch.errorMessage);
    return true;
  }

  async retryFailedBatch(batchId: string, approver: PayoutApprover): Promise<boolean> {
    this.assertApprover(approver);
    const batch = this.batches.find((b) => b.id === batchId);
    // Rejected payouts are final; a retry would bypass the review that rejected them.
    if (!batch || batch.status !== 'failed' || batch.rejectedBy) return false;
    if (batch.attempts >= batch.maxAttempts) return false;

    this.transition(batch, 'pending');
    delete batch.errorMessage;
    delete batch.errorCode;
    delete batch.nextAttemptAt;
    this.record(batch.id, 'retried', approver.id, 'Returned to approval queue');
    // Deliberately not settled here: a manual retry re-enters the approval queue so the
    // batch is re-reviewed rather than pushed straight through to the rail.
    return true;
  }

  /**
   * Returns a terminally failed batch's reserved amount to the merchant's pending balance.
   *
   * Required to unblock a merchant whose payout exhausted its attempt budget: the
   * reservation is otherwise held indefinitely. Approver-gated, like every other
   * decision that moves money.
   */
  async releaseReservedFunds(batchId: string, approver: PayoutApprover): Promise<boolean> {
    this.assertApprover(approver);
    const batch = this.batches.find((b) => b.id === batchId);
    if (!batch || batch.status !== 'failed' || batch.fundsReleased) return false;

    this.releaseFunds(batch, approver.id);
    this.record(batch.id, 'released', approver.id, `Released ${batch.amount} ${batch.asset} reservation`);
    return true;
  }

  getPayoutHistory(merchantId?: string): PayoutBatch[] {
    const scoped = merchantId ? this.batches.filter((b) => b.merchantId === merchantId) : this.batches;
    return scoped.map(snapshotBatch);
  }

  getBatch(batchId: string): PayoutBatch | undefined {
    const batch = this.batches.find((b) => b.id === batchId);
    return batch ? snapshotBatch(batch) : undefined;
  }

  getAuditTrail(batchId?: string): PayoutAuditEntry[] {
    const entries = batchId ? this.auditTrail.filter((entry) => entry.batchId === batchId) : this.auditTrail;
    return entries.map(snapshotAuditEntry);
  }

  /** Counts by status plus the money still owed to merchants, for dashboards and alerts. */
  getStats(): Record<PayoutStatus, number> & {
    total: number;
    awaitingSettlement: number;
    reservedAmount: number;
  } {
    const counts: Record<PayoutStatus, number> = { pending: 0, executing: 0, completed: 0, failed: 0 };
    for (const batch of this.batches) counts[batch.status] += 1;

    let awaitingSettlement = 0;
    for (const amount of this.pendingAmounts.values()) awaitingSettlement += amount;

    let reservedAmount = 0;
    for (const batch of this.batches) {
      if (batch.status !== 'completed' && !batch.fundsReleased) reservedAmount += batch.amount;
    }

    return { ...counts, total: this.batches.length, awaitingSettlement, reservedAmount };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private assertValidSchedule(schedule: PayoutSchedule): void {
    if (!schedule?.id || schedule.id.length > MAX_ID_LENGTH) throw new Error('INVALID_PAYOUT_SCHEDULE_ID');
    if (!schedule.merchantId || schedule.merchantId.length > MAX_ID_LENGTH) {
      throw new Error('INVALID_PAYOUT_MERCHANT_ID');
    }
    if (!Object.prototype.hasOwnProperty.call(SCHEDULE_PERIOD_MS, schedule.scheduleType)) {
      throw new Error('INVALID_PAYOUT_SCHEDULE_TYPE');
    }
    if (!this.allowedAssets.includes(schedule.preferredAsset)) {
      throw new Error('UNSUPPORTED_PAYOUT_ASSET');
    }
    if (!Number.isFinite(schedule.autoApproveLimit) || schedule.autoApproveLimit < 0) {
      throw new Error('INVALID_PAYOUT_AUTO_APPROVE_LIMIT');
    }
    if (schedule.scheduleType === 'threshold') {
      // `thresholdAmount: 0` used to fall through to the "pay anything" branch.
      if (schedule.thresholdAmount === undefined || !Number.isFinite(schedule.thresholdAmount) || schedule.thresholdAmount <= 0) {
        throw new Error('INVALID_PAYOUT_THRESHOLD_AMOUNT');
      }
    }
  }

  private isTriggerMet(schedule: PayoutSchedule, pending: number): boolean {
    if (pending <= 0) return false;
    if (schedule.scheduleType === 'threshold') {
      return pending >= (schedule.thresholdAmount as number);
    }
    return pending > 0;
  }

  /** `threshold` schedules are always due; calendar schedules wait out their period. */
  private isCalendarSchedule(schedule: PayoutSchedule): boolean {
    return SCHEDULE_PERIOD_MS[schedule.scheduleType] !== null;
  }

  private isScheduleDue(schedule: PayoutSchedule): boolean {
    const period = SCHEDULE_PERIOD_MS[schedule.scheduleType];
    if (period === null) return true;

    const lastRun = this.lastMaterialisedAt.get(schedule.id);
    if (lastRun === undefined) return true;
    return this.now().getTime() - lastRun >= period;
  }

  /**
   * Identifies the payout cycle a batch belongs to.
   *
   * Calendar schedules get one cycle per period bucket so the same week cannot be paid
   * out twice. Threshold schedules have no calendar period, so each materialisation is
   * its own cycle — the reservation on the pending balance is what stops the same funds
   * being paid twice.
   */
  private cycleKeyFor(schedule: PayoutSchedule): string {
    const base = `${schedule.id}:${schedule.merchantId}:${schedule.scheduleType}`;
    const period = SCHEDULE_PERIOD_MS[schedule.scheduleType];
    if (period === null) {
      this.sequence += 1;
      return `${base}:seq-${this.sequence}`;
    }
    return `${base}:${Math.floor(this.now().getTime() / period)}`;
  }

  private createBatch(
    schedule: PayoutSchedule,
    amount: number,
    cycleKey: string,
  ): { batch: PayoutBatch; requiresApproval: boolean } {
    if (amount > this.maxBatchAmount) {
      throw new Error('PAYOUT_AMOUNT_EXCEEDED');
    }

    const createdAt = this.now();
    const batchId = `po_${randomUUID()}`;
    const anomalyFlags =
      this.anomalyDetector?.evaluate({
        reference: batchId,
        merchantId: schedule.merchantId,
        amount,
        asset: schedule.preferredAsset,
        at: createdAt,
      }) ?? [];
    const requiresApproval =
      amount > schedule.autoApproveLimit || amount >= this.approvalThreshold || anomalyFlags.length > 0;

    const batch: PayoutBatch = {
      id: batchId,
      idempotencyKey: `po_${randomUUID()}`,
      merchantId: schedule.merchantId,
      scheduleId: schedule.id,
      cycleKey,
      status: 'pending',
      amount: quantizeNumber(amount, assetDecimals(schedule.preferredAsset)),
      asset: schedule.preferredAsset,
      transactionsCount: 1,
      attempts: 0,
      maxAttempts: this.maxAttempts,
      requiresApproval,
      fundsReleased: false,
      createdAt,
      updatedAt: createdAt,
    };

    // Reserve the funds for every batch so the next evaluation cannot create a duplicate payout.
    this.pendingAmounts.set(schedule.merchantId, 0);
    this.batches.push(batch);
    this.audit('payout.reserved', batch, 'system', {
      requiresApproval,
      cycleKey,
      ...(anomalyFlags.length > 0 ? { anomalyFlags: anomalyFlags.map((flag) => flag.rule) } : {}),
    });
    if (anomalyFlags.length > 0) {
      this.record(batch.id, 'created', 'system', `Held for anomaly review: ${anomalyFlags.map((f) => f.rule).join(', ')}`);
    }

    if (!requiresApproval) {
      this.record(batch.id, 'created', 'system', 'Auto-approved');
      this.emit('payout.created', batch, 'Auto-approved');
    }

    return { batch, requiresApproval };
  }

  /**
   * Runs one settlement attempt. Marks the batch `completed` only when the rail reports
   * a transaction hash; any failure schedules a backed-off retry or fails the batch
   * permanently once the attempt budget is spent.
   */
  private async settle(batch: PayoutBatch, actorId: string): Promise<void> {
    if (batch.status !== 'pending') return;

    batch.attempts += 1;
    this.transition(batch, 'executing');
    this.record(batch.id, 'executing', actorId, `Attempt ${batch.attempts} of ${batch.maxAttempts}`);
    this.emit('payout.executing', batch);

    try {
      const result = await this.executor({
        batchId: batch.id,
        idempotencyKey: batch.idempotencyKey,
        merchantId: batch.merchantId,
        asset: batch.asset,
        amount: batch.amount,
        attempt: batch.attempts,
      });

      if (!result?.transactionHash) {
        throw new Error('EMPTY_PAYOUT_TRANSACTION_HASH');
      }

      this.transition(batch, 'completed');
      batch.transactionHash = result.transactionHash;
      batch.settledAt = result.settledAt ?? this.now();
      delete batch.nextAttemptAt;
      this.record(batch.id, 'settled', actorId, result.transactionHash);
      this.audit('payout.settled', batch, actorId, { transactionHash: result.transactionHash, attempt: batch.attempts });
      this.emit('payout.completed', batch, result.transactionHash);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown payout execution error';
      this.transition(batch, 'failed');
      batch.errorMessage = detail;
      batch.errorCode = 'PAYOUT_EXECUTION_FAILED';
      this.audit('payout.failed', batch, actorId, {
        error: detail,
        attempt: batch.attempts,
        final: batch.attempts >= batch.maxAttempts,
      });

      if (batch.attempts >= batch.maxAttempts) {
        // Terminal failure. The reservation is deliberately kept: returning the funds to
        // the pending balance would immediately mint a fresh batch and spin on a rail
        // that is already failing. An operator calls `releaseReservedFunds` to unblock
        // the merchant once the underlying problem is fixed.
        batch.errorCode = 'PAYOUT_ATTEMPTS_EXHAUSTED';
        this.record(batch.id, 'failed', actorId, detail);
        this.emit('payout.failed', batch, detail);
        return;
      }

      batch.nextAttemptAt = new Date(this.now().getTime() + this.backoffMs(batch.attempts));
      this.record(batch.id, 'failed', actorId, detail);
      this.emit('payout.delayed', batch, `Retry ${batch.attempts + 1} at ${batch.nextAttemptAt.toISOString()}`);
    }
  }

  /** Exponential backoff with symmetric jitter, capped at `retryMaxMs`. */
  private backoffMs(attempts: number): number {
    const uncapped = this.retryBaseMs * 2 ** Math.max(0, attempts - 1);
    const capped = Math.min(uncapped, this.retryMaxMs);
    const jitter = capped * PAYOUT_RETRY_JITTER_RATIO;
    const offset = (this.random() * 2 - 1) * jitter;
    return Math.max(1, Math.round(capped + offset));
  }

  /** Returns a batch's reserved amount to the merchant's pending balance exactly once. */
  private releaseFunds(batch: PayoutBatch, actorId = 'system'): void {
    if (batch.fundsReleased) return;
    batch.fundsReleased = true;
    this.audit('payout.released', batch, actorId);
    this.pendingAmounts.set(batch.merchantId, quantizeNumber(this.getPendingAmount(batch.merchantId) + batch.amount, assetDecimals(batch.asset)));
    this.record(batch.id, 'released', 'system', `Returned ${batch.amount} ${batch.asset} to pending balance`);
  }

  private transition(batch: PayoutBatch, next: PayoutStatus): void {
    const allowed = ALLOWED_TRANSITIONS[batch.status];
    if (!allowed.includes(next)) {
      throw new Error(`INVALID_PAYOUT_TRANSITION:${batch.status}->${next}`);
    }
    batch.status = next;
    batch.updatedAt = this.now();
  }

  private assertApprover(approver: PayoutApprover): void {
    if (!approver?.id || !APPROVER_ROLES.includes(approver.role)) {
      throw new Error('PAYOUT_APPROVER_FORBIDDEN');
    }
  }

  private record(batchId: string, action: PayoutAuditEntry['action'], actorId: string, details?: string): void {
    this.auditTrail.push({ batchId, action, actorId, timestamp: this.now(), details });
  }

  private audit(
    operation: MoneyMovementOperation,
    batch: PayoutBatch,
    actorId: string,
    metadata: Record<string, unknown> = {},
  ): void {
    this.auditLog?.record({
      actor: actorId,
      operation,
      amount: batch.amount,
      asset: batch.asset,
      reference: batch.id,
      merchantId: batch.merchantId,
      metadata: { scheduleId: batch.scheduleId, ...metadata },
    });
  }

  private emit(type: PayoutEventType, batch: PayoutBatch, detail?: string): void {
    if (!this.onEvent) return;
    try {
      this.onEvent({
        type,
        batchId: batch.id,
        merchantId: batch.merchantId,
        amount: batch.amount,
        asset: batch.asset,
        attempt: batch.attempts,
        at: this.now(),
        detail,
      });
    } catch {
      // A failing subscriber must never abort a payout decision.
    }
  }
}

export const payoutEngine = new PayoutEngine({
  auditLog: moneyMovementAuditLog,
  anomalyDetector: payoutAnomalyDetector,
});