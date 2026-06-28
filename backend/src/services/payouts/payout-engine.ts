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
  status: 'pending' | 'executing' | 'completed' | 'failed';
  amount: number;
  asset: string;
  transactionsCount: number;
  errorMessage?: string;
  createdAt: Date;
}

export class PayoutEngine {
  private schedules: PayoutSchedule[] = [];
  private batches: PayoutBatch[] = [];
  private pendingAmounts: Map<string, number> = new Map(); // merchantId -> amount

  setPendingAmount(merchantId: string, amount: number) {
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
        const batchId = Math.random().toString(36).substring(7);
        const batch: PayoutBatch = {
          id: batchId,
          status: pending > schedule.autoApproveLimit ? 'pending' : 'completed',
          amount: pending,
          asset: schedule.preferredAsset,
          transactionsCount: 1,
          createdAt: new Date(),
        };

        if (batch.status === 'completed') {
          this.pendingAmounts.set(schedule.merchantId, 0);
        }

        this.batches.push(batch);
        executedBatches.push(batch);
      }
    }

    return executedBatches;
  }

  async approveManualPayout(batchId: string): Promise<boolean> {
    const batch = this.batches.find(b => b.id === batchId);
    if (batch && batch.status === 'pending') {
      batch.status = 'completed';
      return true;
    }
    return false;
  }

  async rejectManualPayout(batchId: string): Promise<boolean> {
    const batch = this.batches.find(b => b.id === batchId);
    if (batch && batch.status === 'pending') {
      batch.status = 'failed';
      batch.errorMessage = 'Rejected by manual review';
      return true;
    }
    return false;
  }

  async retryFailedBatch(batchId: string): Promise<boolean> {
    const batch = this.batches.find(b => b.id === batchId);
    if (batch && batch.status === 'failed') {
      batch.status = 'completed';
      delete batch.errorMessage;
      return true;
    }
    return false;
  }

  getPayoutHistory(): PayoutBatch[] {
    return this.batches;
  }
}
