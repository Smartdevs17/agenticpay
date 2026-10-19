/**
 * Payout scheduling and batching — Issue #1008
 *
 * Individual payouts are scheduled for a future time instead of being sent one at a time.
 * When a run fires, due payouts are grouped by (provider, asset) and chunked into
 * provider batches; each batch is sent to the provider in a single call so the per-call
 * fee is paid once per batch rather than once per payout.
 *
 * - Atomic per provider call: a batch either settles every item it carries (one
 *   transaction hash for all of them) or fails every item. A provider that reports
 *   anything other than full success is treated as a failure for the whole batch.
 * - Failures are isolated: one batch failing never affects the other batches of the same
 *   run. Its items return to the queue for a backed-off retry until `maxAttempts` is spent.
 * - Reporting: `getBatchReport` / `getRunReport` show each batch's status, item outcomes,
 *   totals and the provider fees saved by batching.
 *
 * Optional integrations: every scheduling decision and settlement is written to the
 * money-movement audit log (#1011), and every scheduled payout is scored by the anomaly
 * detector (#1013). A flagged payout is held out of batches until its flag is reviewed.
 */

import { randomUUID } from 'node:crypto';
import { moneyMovementAuditLog, type MoneyMovementAuditLog } from '../../audit/money-movement-audit.js';
import {
  payoutAnomalyDetector,
  type PayoutAnomalyDetector,
  type PayoutAnomalyFlag,
} from './payout-anomaly-detector.js';
import {
  DEFAULT_PAYOUT_IDEMPOTENCY_TTL_MS,
  PayoutIdempotencyStore,
  fingerprintPayoutRequest,
} from './payout-idempotency.js';

export const DEFAULT_PAYOUT_PROVIDER = 'default';
export const DEFAULT_MAX_BATCH_SIZE = 100;
export const DEFAULT_SCHEDULED_PAYOUT_MAX_ATTEMPTS = 3;
export const DEFAULT_BATCH_RETRY_DELAY_MS = 5 * 60 * 1000;

export type ScheduledPayoutStatus = 'scheduled' | 'held' | 'batched' | 'paid' | 'failed' | 'cancelled';

export interface ScheduleScheduledPayoutInput {
  merchantId: string;
  recipient: string;
  amount: number;
  asset: string;
  /** When the payout becomes eligible for a batch. Defaults to now. */
  scheduledFor?: Date;
  provider?: string;
  /** Caller reference, echoed back in reports. */
  reference?: string;
  actorId?: string;
  /**
   * Idempotency key (#1005). Scheduling twice with the same key and body returns the
   * original payout; the same key with a different body is rejected.
   */
  idempotencyKey?: string;
}

export interface ScheduledPayout {
  id: string;
  merchantId: string;
  recipient: string;
  amount: number;
  asset: string;
  provider: string;
  reference?: string;
  scheduledFor: Date;
  status: ScheduledPayoutStatus;
  attempts: number;
  batchId?: string;
  transactionHash?: string;
  lastError?: string;
  /** Anomaly flags holding this payout out of batches. */
  anomalyFlagIds?: string[];
  createdAt: Date;
  updatedAt: Date;
  /** Optimistic locking version - incremented on each status change */
  version: number;
}

export interface ProviderBatchItem {
  payoutId: string;
  recipient: string;
  amount: number;
}

export interface ProviderBatchRequest {
  batchId: string;
  /** Stable per batch attempt, so a provider can deduplicate a replayed call. */
  idempotencyKey: string;
  provider: string;
  asset: string;
  totalAmount: number;
  items: ProviderBatchItem[];
}

export interface ProviderBatchResult {
  /** One transaction covering every item in the batch. */
  transactionHash: string;
  /**
   * Optional per-item acknowledgement. When present it must acknowledge every item;
   * a partial acknowledgement fails the whole batch.
   */
  acceptedPayoutIds?: string[];
}

/** Sends one batch in one provider call. Rejecting fails every item in the batch. */
export type PayoutBatchProvider = (request: ProviderBatchRequest) => Promise<ProviderBatchResult>;

export type PayoutBatchStatus = 'executing' | 'completed' | 'failed';

export interface PayoutBatchRecord {
  id: string;
  runId: string;
  provider: string;
  asset: string;
  status: PayoutBatchStatus;
  payoutIds: string[];
  totalAmount: number;
  attempt: number;
  transactionHash?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

export interface PayoutBatchReport extends PayoutBatchRecord {
  itemCount: number;
  items: Array<Pick<ScheduledPayout, 'id' | 'merchantId' | 'recipient' | 'amount' | 'status' | 'reference'>>;
  /** Provider fees avoided by sending the items together instead of one call each. */
  estimatedFeesSaved: number;
}

export interface PayoutRunReport {
  runId: string;
  startedAt: Date;
  completedAt: Date;
  batches: PayoutBatchReport[];
  summary: {
    batchCount: number;
    completed: number;
    failed: number;
    payoutsPaid: number;
    payoutsFailed: number;
    amountPaidByAsset: Record<string, number>;
    estimatedFeesSaved: number;
  };
}

export interface PayoutBatcherOptions {
  /** Providers by name. A payout naming an unknown provider is rejected at scheduling time. */
  providers?: Record<string, PayoutBatchProvider>;
  maxBatchSize?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Flat fee a provider charges per call, used for the fees-saved estimate. */
  feePerProviderCall?: number;
  auditLog?: MoneyMovementAuditLog;
  anomalyDetector?: PayoutAnomalyDetector;
  /** How long a payout-creation idempotency key is remembered. Defaults to 24h. */
  idempotencyTtlMs?: number;
  now?: () => Date;
}

const MAX_ID_LENGTH = 128;

/** Local, no-network provider so the batcher has a working default path. */
const defaultProvider: PayoutBatchProvider = async (request) => ({
  transactionHash: `pb_exec_${request.idempotencyKey}`,
});

function snapshotPayout(payout: ScheduledPayout): ScheduledPayout {
  return {
    ...payout,
    ...(payout.anomalyFlagIds ? { anomalyFlagIds: [...payout.anomalyFlagIds] } : {}),
    scheduledFor: new Date(payout.scheduledFor),
    createdAt: new Date(payout.createdAt),
    updatedAt: new Date(payout.updatedAt),
  };
}

function requireText(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) throw new Error(code);
  return value;
}

export class PayoutBatcher {
  private readonly payouts = new Map<string, ScheduledPayout>();
  private readonly batches = new Map<string, PayoutBatchRecord>();
  private readonly runs = new Map<string, PayoutRunReport>();
  private readonly providers: Record<string, PayoutBatchProvider>;
  private readonly auditLog?: MoneyMovementAuditLog;
  private readonly anomalyDetector?: PayoutAnomalyDetector;
  private readonly idempotency: PayoutIdempotencyStore<ScheduledPayout>;
  private readonly now: () => Date;
  private runInFlight = false;

  readonly maxBatchSize: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly feePerProviderCall: number;

  constructor(options: PayoutBatcherOptions = {}) {
    this.providers = { [DEFAULT_PAYOUT_PROVIDER]: defaultProvider, ...options.providers };
    this.maxBatchSize = Math.floor(options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE);
    this.maxAttempts = Math.floor(options.maxAttempts ?? DEFAULT_SCHEDULED_PAYOUT_MAX_ATTEMPTS);
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_BATCH_RETRY_DELAY_MS;
    this.feePerProviderCall = options.feePerProviderCall ?? 0;
    if (!(this.maxBatchSize >= 1)) throw new Error('INVALID_PAYOUT_BATCH_SIZE');
    if (!(this.maxAttempts >= 1)) throw new Error('INVALID_PAYOUT_MAX_ATTEMPTS');
    if (!Number.isFinite(this.retryDelayMs) || this.retryDelayMs < 0) throw new Error('INVALID_PAYOUT_RETRY_DELAY');
    if (!Number.isFinite(this.feePerProviderCall) || this.feePerProviderCall < 0) {
      throw new Error('INVALID_PAYOUT_PROVIDER_FEE');
    }

    this.auditLog = options.auditLog;
    this.anomalyDetector = options.anomalyDetector;
    this.now = options.now ?? (() => new Date());
    // Share the batcher clock with the idempotency store so an injected `now` drives
    // key expiry as well as payout timestamps.
    this.idempotency = new PayoutIdempotencyStore<ScheduledPayout>(
      options.idempotencyTtlMs ?? DEFAULT_PAYOUT_IDEMPOTENCY_TTL_MS,
      undefined,
      () => this.now().getTime(),
    );
    this.anomalyDetector?.onReview((flag) => this.onAnomalyReviewed(flag));
  }

  /** Queues a payout for the next run at or after `scheduledFor`. */
  schedule(input: ScheduleScheduledPayoutInput): ScheduledPayout {
    const merchantId = requireText(input.merchantId, 'INVALID_PAYOUT_MERCHANT_ID');
    const recipient = requireText(input.recipient, 'INVALID_PAYOUT_RECIPIENT');
    const asset = requireText(input.asset, 'INVALID_PAYOUT_ASSET');
    const provider = input.provider ?? DEFAULT_PAYOUT_PROVIDER;
    if (!Object.prototype.hasOwnProperty.call(this.providers, provider)) throw new Error('UNKNOWN_PAYOUT_PROVIDER');
    if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('INVALID_PAYOUT_AMOUNT');
    }
    if (input.reference !== undefined) requireText(input.reference, 'INVALID_PAYOUT_REFERENCE');
    const scheduledFor = input.scheduledFor ?? this.now();
    if (!(scheduledFor instanceof Date) || Number.isNaN(scheduledFor.getTime())) {
      throw new Error('INVALID_PAYOUT_SCHEDULED_FOR');
    }

    // Idempotency (#1005): replay an earlier scheduling result verbatim, and reject a
    // key that is being reused with a different body rather than silently paying twice.
    const idempotencyKey =
      input.idempotencyKey !== undefined
        ? requireText(input.idempotencyKey, 'INVALID_PAYOUT_IDEMPOTENCY_KEY')
        : undefined;
    const fingerprint = fingerprintPayoutRequest({
      merchantId,
      recipient,
      asset,
      provider,
      amount: input.amount,
      reference: input.reference,
      scheduledFor: input.scheduledFor ? scheduledFor.toISOString() : undefined,
    });

    if (idempotencyKey) {
      const existing = this.idempotency.lookup(idempotencyKey, fingerprint);
      if (existing.status === 'mismatch') throw new Error('IDEMPOTENCY_KEY_REUSE_MISMATCH');
      if (existing.status === 'replay') return snapshotPayout(existing.value);
    }

    const createdAt = this.now();
    const payout: ScheduledPayout = {
      id: `spo_${randomUUID()}`,
      merchantId,
      recipient,
      amount: input.amount,
      asset,
      provider,
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      scheduledFor: new Date(scheduledFor),
      status: 'scheduled',
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
      version: 1,
    };
    this.payouts.set(payout.id, payout);

    const actor = input.actorId ?? 'system';
    this.audit(actor, 'payout.scheduled', payout, { scheduledFor: payout.scheduledFor.toISOString(), provider });

    const flags =
      this.anomalyDetector?.evaluate({
        reference: payout.id,
        merchantId,
        amount: payout.amount,
        asset,
        at: createdAt,
      }) ?? [];
    if (flags.length > 0) {
      payout.status = 'held';
      payout.anomalyFlagIds = flags.map((flag) => flag.id);
      this.audit('system', 'payout.held', payout, { rules: flags.map((flag) => flag.rule) });
    }

    const snapshot = snapshotPayout(payout);
    if (idempotencyKey) this.idempotency.save(idempotencyKey, fingerprint, snapshot);
    return snapshot;
  }

  /** Drops expired payout-creation idempotency keys. Call from a scheduled job. */
  purgeExpiredIdempotencyKeys(): number {
    return this.idempotency.purgeExpired();
  }

  /** Cancels a payout that has not been sent yet. */
  cancel(payoutId: string, actorId = 'system'): boolean {
    const payout = this.payouts.get(payoutId);
    if (!payout || (payout.status !== 'scheduled' && payout.status !== 'held')) return false;
    const expectedVersion = payout.version;
    this.setStatus(payout, 'cancelled', expectedVersion);
    this.audit(actorId, 'payout.cancelled', payout);
    return true;
  }

  /**
   * Sends every due payout. Due payouts are grouped by provider and asset, split into
   * batches of at most `maxBatchSize`, and each batch is one provider call. Batches run
   * one after another; a failed batch is recorded and the run moves on.
   *
   * Overlapping runs are refused (returns `undefined`) so a payout is never batched twice.
   */
  async runDue(): Promise<PayoutRunReport | undefined> {
    if (this.runInFlight) return undefined;
    this.runInFlight = true;

    try {
      const runId = `prun_${randomUUID()}`;
      const startedAt = this.now();
      const due = [...this.payouts.values()]
        .filter((payout) => payout.status === 'scheduled' && payout.scheduledFor.getTime() <= startedAt.getTime())
        .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime() || a.id.localeCompare(b.id));

      const groups = new Map<string, ScheduledPayout[]>();
      for (const payout of due) {
        const key = `${payout.provider}\u0000${payout.asset}`;
        const group = groups.get(key) ?? [];
        group.push(payout);
        groups.set(key, group);
      }

      const batchIds: string[] = [];
      for (const group of groups.values()) {
        for (let i = 0; i < group.length; i += this.maxBatchSize) {
          batchIds.push(await this.sendBatch(runId, group.slice(i, i + this.maxBatchSize)));
        }
      }

      const report = this.buildRunReport(runId, startedAt, batchIds);
      this.runs.set(runId, report);
      return report;
    } finally {
      this.runInFlight = false;
    }
  }

  getPayout(payoutId: string): ScheduledPayout | undefined {
    const payout = this.payouts.get(payoutId);
    return payout ? snapshotPayout(payout) : undefined;
  }

  listPayouts(filter: { merchantId?: string; status?: ScheduledPayoutStatus } = {}): ScheduledPayout[] {
    return [...this.payouts.values()]
      .filter((payout) => !filter.merchantId || payout.merchantId === filter.merchantId)
      .filter((payout) => !filter.status || payout.status === filter.status)
      .map(snapshotPayout);
  }

  getBatchReport(batchId: string): PayoutBatchReport | undefined {
    const batch = this.batches.get(batchId);
    return batch ? this.toBatchReport(batch) : undefined;
  }

  listBatchReports(filter: { status?: PayoutBatchStatus } = {}): PayoutBatchReport[] {
    return [...this.batches.values()]
      .filter((batch) => !filter.status || batch.status === filter.status)
      .map((batch) => this.toBatchReport(batch));
  }

  getRunReport(runId: string): PayoutRunReport | undefined {
    const run = this.runs.get(runId);
    // Rebuilt so item statuses reflect any retries since the run.
    return run ? this.buildRunReport(run.runId, run.startedAt, run.batches.map((b) => b.id), run.completedAt) : undefined;
  }

  /** Clears all state. Intended for tests. */
  reset(): void {
    this.payouts.clear();
    this.batches.clear();
    this.runs.clear();
    this.idempotency.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async sendBatch(runId: string, items: ScheduledPayout[]): Promise<string> {
    const { provider, asset } = items[0];
    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
    const batch: PayoutBatchRecord = {
      id: `pbat_${randomUUID()}`,
      runId,
      provider,
      asset,
      status: 'executing',
      payoutIds: items.map((item) => item.id),
      totalAmount,
      attempt: Math.max(...items.map((item) => item.attempts)) + 1,
      startedAt: this.now(),
    };
    this.batches.set(batch.id, batch);

    for (const item of items) {
      item.attempts += 1;
      item.batchId = batch.id;
      delete item.lastError;
      const expectedVersion = item.version;
      this.setStatus(item, 'batched', expectedVersion);
    }

    try {
      const result = await this.providers[provider]({
        batchId: batch.id,
        idempotencyKey: `${batch.id}:${batch.attempt}`,
        provider,
        asset,
        totalAmount,
        items: items.map((item) => ({ payoutId: item.id, recipient: item.recipient, amount: item.amount })),
      });

      if (!result?.transactionHash) throw new Error('EMPTY_PAYOUT_BATCH_TRANSACTION_HASH');
      if (result.acceptedPayoutIds) {
        const accepted = new Set(result.acceptedPayoutIds);
        if (accepted.size !== items.length || items.some((item) => !accepted.has(item.id))) {
          // All-or-nothing: a partial acknowledgement is not a settled batch.
          throw new Error('PARTIAL_PAYOUT_BATCH_ACKNOWLEDGEMENT');
        }
      }

      batch.status = 'completed';
      batch.transactionHash = result.transactionHash;
      batch.completedAt = this.now();
      for (const item of items) {
        item.transactionHash = result.transactionHash;
        const expectedVersion = item.version;
        this.setStatus(item, 'paid', expectedVersion);
        this.audit('system', 'payout.settled', item, { batchId: batch.id, transactionHash: result.transactionHash });
      }
      this.auditBatch('payout_batch.settled', batch, { transactionHash: result.transactionHash });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown payout batch error';
      batch.status = 'failed';
      batch.error = message;
      batch.completedAt = this.now();
      for (const item of items) {
        item.lastError = message;
        const expectedVersion = item.version;
        if (item.attempts >= this.maxAttempts) {
          this.setStatus(item, 'failed', expectedVersion);
          this.audit('system', 'payout.failed', item, { batchId: batch.id, error: message, final: true });
        } else {
          // Back to the queue on its own: the retry may land in a different batch.
          item.scheduledFor = new Date(this.now().getTime() + this.retryDelayMs);
          this.setStatus(item, 'scheduled', expectedVersion);
          this.audit('system', 'payout.failed', item, { batchId: batch.id, error: message, final: false });
        }
      }
      this.auditBatch('payout_batch.failed', batch, { error: message });
    }

    return batch.id;
  }

  private onAnomalyReviewed(flag: PayoutAnomalyFlag): void {
    const payout = this.payouts.get(flag.reference);
    if (!payout || payout.status !== 'held') return;

    const expectedVersion = payout.version;
    if (flag.status === 'confirmed') {
      this.setStatus(payout, 'cancelled', expectedVersion);
      this.audit(flag.reviewedBy ?? 'system', 'payout.cancelled', payout, { anomalyFlagId: flag.id });
      return;
    }

    // Released only once every flag on the payout has been cleared as a false positive.
    if (this.anomalyDetector?.hasOpenFlags(payout.id)) return;
    this.setStatus(payout, 'scheduled', expectedVersion);
    this.audit(flag.reviewedBy ?? 'system', 'payout.scheduled', payout, {
      releasedFromHold: true,
      anomalyFlagIds: payout.anomalyFlagIds ?? [],
    });
  }

  private toBatchReport(batch: PayoutBatchRecord): PayoutBatchReport {
    const items = batch.payoutIds
      .map((id) => this.payouts.get(id))
      .filter((payout): payout is ScheduledPayout => payout !== undefined)
      .map((payout) => ({
        id: payout.id,
        merchantId: payout.merchantId,
        recipient: payout.recipient,
        amount: payout.amount,
        // Status of the item *in this batch*: a later retry does not rewrite history.
        status: (batch.status === 'completed' ? 'paid' : batch.status === 'failed' ? 'failed' : 'batched') as ScheduledPayoutStatus,
        ...(payout.reference !== undefined ? { reference: payout.reference } : {}),
      }));

    return {
      ...batch,
      payoutIds: [...batch.payoutIds],
      startedAt: new Date(batch.startedAt),
      ...(batch.completedAt ? { completedAt: new Date(batch.completedAt) } : {}),
      itemCount: items.length,
      items,
      estimatedFeesSaved: Math.max(0, items.length - 1) * this.feePerProviderCall,
    };
  }

  private buildRunReport(runId: string, startedAt: Date, batchIds: string[], completedAt = this.now()): PayoutRunReport {
    const batches = batchIds
      .map((id) => this.batches.get(id))
      .filter((batch): batch is PayoutBatchRecord => batch !== undefined)
      .map((batch) => this.toBatchReport(batch));

    const amountPaidByAsset: Record<string, number> = {};
    let payoutsPaid = 0;
    let payoutsFailed = 0;
    for (const batch of batches) {
      if (batch.status === 'completed') {
        payoutsPaid += batch.itemCount;
        amountPaidByAsset[batch.asset] = (amountPaidByAsset[batch.asset] ?? 0) + batch.totalAmount;
      } else if (batch.status === 'failed') {
        payoutsFailed += batch.itemCount;
      }
    }

    return {
      runId,
      startedAt: new Date(startedAt),
      completedAt: new Date(completedAt),
      batches,
      summary: {
        batchCount: batches.length,
        completed: batches.filter((batch) => batch.status === 'completed').length,
        failed: batches.filter((batch) => batch.status === 'failed').length,
        payoutsPaid,
        payoutsFailed,
        amountPaidByAsset,
        estimatedFeesSaved: batches
          .filter((batch) => batch.status === 'completed')
          .reduce((sum, batch) => sum + batch.estimatedFeesSaved, 0),
      },
    };
  }

  private setStatus(payout: ScheduledPayout, status: ScheduledPayoutStatus, expectedVersion?: number): void {
    // Optimistic locking: reject if version doesn't match expected (race condition prevention)
    if (expectedVersion !== undefined && payout.version !== expectedVersion) {
      throw new Error('PAYOUT_VERSION_CONFLICT');
    }
    payout.status = status;
    payout.updatedAt = this.now();
    payout.version += 1;
  }

  private audit(
    actor: string,
    operation: Parameters<MoneyMovementAuditLog['record']>[0]['operation'],
    payout: ScheduledPayout,
    metadata: Record<string, unknown> = {},
  ): void {
    this.auditLog?.record({
      actor,
      operation,
      amount: payout.amount,
      asset: payout.asset,
      reference: payout.id,
      merchantId: payout.merchantId,
      metadata: { recipient: payout.recipient, ...(payout.reference ? { clientReference: payout.reference } : {}), ...metadata },
    });
  }

  private auditBatch(
    operation: 'payout_batch.settled' | 'payout_batch.failed',
    batch: PayoutBatchRecord,
    metadata: Record<string, unknown>,
  ): void {
    this.auditLog?.record({
      actor: 'system',
      operation,
      amount: batch.totalAmount,
      asset: batch.asset,
      reference: batch.id,
      metadata: { provider: batch.provider, payoutIds: [...batch.payoutIds], attempt: batch.attempt, ...metadata },
    });
  }
}

function positiveEnvNumber(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Process-wide batcher, wired to the shared audit log and anomaly detector. */
export const payoutBatcher = new PayoutBatcher({
  maxBatchSize: positiveEnvNumber('PAYOUT_BATCH_MAX_SIZE'),
  feePerProviderCall: positiveEnvNumber('PAYOUT_PROVIDER_FEE_PER_CALL'),
  auditLog: moneyMovementAuditLog,
  anomalyDetector: payoutAnomalyDetector,
});

/** How often scheduled payouts are checked for a due batch run. */
export const DEFAULT_PAYOUT_BATCH_INTERVAL_MS = 60_000;

export interface PayoutBatchWorker {
  /** Runs one batch pass now. Never rejects. */
  tick(): Promise<PayoutRunReport | undefined>;
  stop(): void;
}

/** Drives `runDue` on an interval; passes never overlap and a failed pass is logged. */
export function startPayoutBatchWorker(
  batcher: Pick<PayoutBatcher, 'runDue'> = payoutBatcher,
  intervalMs: number = DEFAULT_PAYOUT_BATCH_INTERVAL_MS,
): PayoutBatchWorker {
  let running = false;

  const tick = async (): Promise<PayoutRunReport | undefined> => {
    if (running) return undefined;
    running = true;
    try {
      return await batcher.runDue();
    } catch (error) {
      console.error('[payouts] Batch run failed', error);
      return undefined;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();

  return { tick, stop: () => clearInterval(timer) };
}
