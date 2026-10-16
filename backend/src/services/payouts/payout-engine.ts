import { randomUUID } from 'node:crypto';

export const DEFAULT_PAYOUT_APPROVAL_THRESHOLD = 10_000;

export type PayoutApproverRole = 'finance_approver' | 'admin';

export interface PayoutApprover {
  id: string;
  role: PayoutApproverRole;
}

export interface PayoutSchedule {
  id: string;
  merchantId: string;
  scheduleType: 'daily' | 'weekly' | 'monthly' | 'threshold';
  thresholdAmount?: number;
  preferredAsset: string;
  autoApproveLimit: number;
}

export interface PayoutBatch {
  id: string;
  merchantId: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  amount: number;
  asset: string;
  transactionsCount: number;
  errorMessage?: string;
  rejectedBy?: string;
  createdAt: Date;
}

export interface PayoutAuditEntry {
  batchId: string;
  action: 'created' | 'approved' | 'rejected' | 'retried';
  actorId: string;
  timestamp: Date;
  details?: string;
}

export interface PayoutEngineOptions {
  /** Payouts at or above this amount always need an approver. Defaults to PAYOUT_APPROVAL_THRESHOLD or 10,000. */
  approvalThreshold?: number;
}

const APPROVER_ROLES: readonly PayoutApproverRole[] = ['finance_approver', 'admin'];

function snapshotBatch(batch: PayoutBatch): PayoutBatch {
  return { ...batch, createdAt: new Date(batch.createdAt) };
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

export class PayoutEngine {
  private schedules: PayoutSchedule[] = [];
  private batches: PayoutBatch[] = [];
  private auditTrail: PayoutAuditEntry[] = [];
  private pendingAmounts: Map<string, number> = new Map(); // merchantId -> amount
  readonly approvalThreshold: number;

  constructor(options: PayoutEngineOptions = {}) {
    this.approvalThreshold = resolveApprovalThreshold(options.approvalThreshold);
  }

  setPendingAmount(merchantId: string, amount: number) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('INVALID_PENDING_PAYOUT_AMOUNT');
    }
    this.pendingAmounts.set(merchantId, amount);
  }

  getPendingAmount(merchantId: string): number {
    return this.pendingAmounts.get(merchantId) || 0;
  }

  configureSchedule(schedule: PayoutSchedule) {
    this.schedules = this.schedules.filter(s => s.merchantId !== schedule.merchantId);
    this.schedules.push(schedule);
  }

  async evaluatePayouts(): Promise<PayoutBatch[]> {
    const executedBatches: PayoutBatch[] = [];

    for (const schedule of this.schedules) {
      const pending = this.getPendingAmount(schedule.merchantId);
      let triggerPayout = false;

      if (schedule.scheduleType === 'threshold' && schedule.thresholdAmount) {
        triggerPayout = pending >= schedule.thresholdAmount;
      } else {
        triggerPayout = pending > 0;
      }

      if (triggerPayout) {
        const requiresApproval = pending > schedule.autoApproveLimit || pending >= this.approvalThreshold;
        const batch: PayoutBatch = {
          id: randomUUID(),
          merchantId: schedule.merchantId,
          status: requiresApproval ? 'pending' : 'completed',
          amount: pending,
          asset: schedule.preferredAsset,
          transactionsCount: 1,
          createdAt: new Date(),
        };

        // Reserve the funds for every batch so the next evaluation cannot create a duplicate payout.
        this.pendingAmounts.set(schedule.merchantId, 0);
        this.batches.push(batch);
        this.record(batch.id, 'created', 'system', requiresApproval ? 'Awaiting approval' : 'Auto-approved');
        executedBatches.push(snapshotBatch(batch));
      }
    }

    return executedBatches;
  }

  async approveManualPayout(batchId: string, approver: PayoutApprover): Promise<boolean> {
    this.assertApprover(approver);
    const batch = this.batches.find(b => b.id === batchId);
    if (batch && batch.status === 'pending') {
      batch.status = 'completed';
      this.record(batchId, 'approved', approver.id);
      return true;
    }
    return false;
  }

  async rejectManualPayout(batchId: string, approver: PayoutApprover): Promise<boolean> {
    this.assertApprover(approver);
    const batch = this.batches.find(b => b.id === batchId);
    if (batch && batch.status === 'pending') {
      batch.status = 'failed';
      batch.errorMessage = 'Rejected by manual review';
      batch.rejectedBy = approver.id;
      // Return the reserved funds to the merchant's pending balance.
      this.pendingAmounts.set(batch.merchantId, this.getPendingAmount(batch.merchantId) + batch.amount);
      this.record(batchId, 'rejected', approver.id, batch.errorMessage);
      return true;
    }
    return false;
  }

  async retryFailedBatch(batchId: string, approver: PayoutApprover): Promise<boolean> {
    this.assertApprover(approver);
    const batch = this.batches.find(b => b.id === batchId);
    // Rejected payouts are final; a retry would bypass the review that rejected them.
    if (batch && batch.status === 'failed' && !batch.rejectedBy) {
      batch.status = 'pending';
      delete batch.errorMessage;
      this.record(batchId, 'retried', approver.id, 'Returned to approval queue');
      return true;
    }
    return false;
  }

  getPayoutHistory(): PayoutBatch[] {
    return this.batches.map(snapshotBatch);
  }

  getAuditTrail(batchId?: string): PayoutAuditEntry[] {
    const entries = batchId ? this.auditTrail.filter(entry => entry.batchId === batchId) : this.auditTrail;
    return entries.map(snapshotAuditEntry);
  }

  private assertApprover(approver: PayoutApprover): void {
    if (!approver?.id || !APPROVER_ROLES.includes(approver.role)) {
      throw new Error('PAYOUT_APPROVER_FORBIDDEN');
    }
  }

  private record(batchId: string, action: PayoutAuditEntry['action'], actorId: string, details?: string): void {
    this.auditTrail.push({ batchId, action, actorId, timestamp: new Date(), details });
  }
}
