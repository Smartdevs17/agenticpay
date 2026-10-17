/**
 * payout-reliability.ts — Issue #1160
 *
 * Payout reliability improvements with idempotency, deduplication,
 * state tracking, and recovery mechanisms.
 */

export type PayoutStatus = 'pending' | 'in_progress' | 'confirmed' | 'failed' | 'recovered';

export interface PayoutAttempt {
  id: string;
  timestamp: number;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  txHash?: string;
}

export interface PayoutRecord {
  id: string;
  userId: string;
  recipientAddress: string;
  amount: number;
  currency: string;
  chainId: string;
  status: PayoutStatus;
  idempotencyKey: string;
  attempts: PayoutAttempt[];
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  failedAt?: number;
}

export class PayoutReliabilityService {
  private payouts: Map<string, PayoutRecord> = new Map();
  private idempotencyMap: Map<string, string> = new Map(); // idempotencyKey → payoutId
  private recipientIndex: Map<string, Set<string>> = new Map(); // recipientAddress → Set<payoutIds>
  private readonly MAX_ATTEMPTS = 5;
  private readonly CONFIRMATION_TIMEOUT_MS = 3600000; // 1 hour

  createPayout(
    id: string,
    userId: string,
    recipientAddress: string,
    amount: number,
    currency: string,
    chainId: string,
    idempotencyKey: string
  ): { success: boolean; payout?: PayoutRecord; error?: string } {
    // Check idempotency - return existing payout if already created
    const existingId = this.idempotencyMap.get(idempotencyKey);
    if (existingId) {
      const existingPayout = this.payouts.get(existingId);
      if (existingPayout) {
        return { success: true, payout: existingPayout };
      }
    }

    // Validate inputs
    if (!recipientAddress || recipientAddress.length < 10) {
      return { success: false, error: 'Invalid recipient address' };
    }

    if (amount <= 0) {
      return { success: false, error: 'Payout amount must be positive' };
    }

    const now = Date.now();
    const payout: PayoutRecord = {
      id,
      userId,
      recipientAddress,
      amount,
      currency,
      chainId,
      status: 'pending',
      idempotencyKey,
      attempts: [],
      createdAt: now,
      updatedAt: now,
    };

    this.payouts.set(id, payout);
    this.idempotencyMap.set(idempotencyKey, id);

    const recipients = this.recipientIndex.get(recipientAddress) || new Set();
    recipients.add(id);
    this.recipientIndex.set(recipientAddress, recipients);

    return { success: true, payout };
  }

  recordAttempt(
    payoutId: string,
    success: boolean,
    options?: { error?: string; txHash?: string }
  ): { success: boolean; payout?: PayoutRecord; error?: string } {
    const payout = this.payouts.get(payoutId);
    if (!payout) {
      return { success: false, error: `Payout ${payoutId} not found` };
    }

    if (payout.attempts.length >= this.MAX_ATTEMPTS) {
      return { success: false, error: 'Maximum attempt limit reached' };
    }

    const attempt: PayoutAttempt = {
      id: `attempt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      status: success ? 'success' : 'failed',
      error: options?.error,
      txHash: options?.txHash,
    };

    payout.attempts.push(attempt);
    payout.updatedAt = Date.now();

    if (success) {
      payout.status = 'confirmed';
      payout.confirmedAt = Date.now();
    } else if (payout.attempts.length >= this.MAX_ATTEMPTS) {
      payout.status = 'failed';
      payout.failedAt = Date.now();
    } else {
      payout.status = 'in_progress';
    }

    this.payouts.set(payoutId, payout);
    return { success: true, payout };
  }

  getPayout(payoutId: string): PayoutRecord | undefined {
    return this.payouts.get(payoutId);
  }

  getPayoutByIdempotencyKey(idempotencyKey: string): PayoutRecord | undefined {
    const id = this.idempotencyMap.get(idempotencyKey);
    return id ? this.payouts.get(id) : undefined;
  }

  getPayoutsByRecipient(recipientAddress: string): PayoutRecord[] {
    const ids = this.recipientIndex.get(recipientAddress) || new Set();
    return Array.from(ids)
      .map((id) => this.payouts.get(id))
      .filter(Boolean) as PayoutRecord[];
  }

  getPayoutsByUser(userId: string): PayoutRecord[] {
    return Array.from(this.payouts.values()).filter((p) => p.userId === userId);
  }

  getPendingPayouts(): PayoutRecord[] {
    return Array.from(this.payouts.values()).filter(
      (p) => p.status === 'pending' || p.status === 'in_progress'
    );
  }

  getFailedPayouts(): PayoutRecord[] {
    return Array.from(this.payouts.values()).filter((p) => p.status === 'failed');
  }

  getConfirmedPayouts(): PayoutRecord[] {
    return Array.from(this.payouts.values()).filter((p) => p.status === 'confirmed');
  }

  canRetry(payoutId: string): boolean {
    const payout = this.payouts.get(payoutId);
    if (!payout) return false;

    if (payout.status === 'confirmed') return false;
    if (payout.attempts.length >= this.MAX_ATTEMPTS) return false;

    return true;
  }

  detectStuckPayouts(): PayoutRecord[] {
    const now = Date.now();
    return Array.from(this.payouts.values()).filter((p) => {
      if (p.status === 'confirmed' || p.status === 'failed') {
        return false;
      }

      const age = now - p.updatedAt;
      return age > this.CONFIRMATION_TIMEOUT_MS;
    });
  }

  recoverStuckPayout(payoutId: string): { success: boolean; payout?: PayoutRecord; error?: string } {
    const payout = this.payouts.get(payoutId);
    if (!payout) {
      return { success: false, error: `Payout ${payoutId} not found` };
    }

    if (payout.status === 'confirmed' || payout.status === 'failed') {
      return { success: false, error: 'Cannot recover completed payout' };
    }

    payout.status = 'recovered';
    payout.updatedAt = Date.now();
    this.payouts.set(payoutId, payout);

    return { success: true, payout };
  }

  getReliabilityMetrics(): {
    totalPayouts: number;
    confirmed: number;
    failed: number;
    pending: number;
    inProgress: number;
    recovered: number;
    successRate: number;
    avgAttemptsPerPayout: number;
    stuckPayouts: number;
  } {
    const payouts = Array.from(this.payouts.values());
    const confirmed = payouts.filter((p) => p.status === 'confirmed').length;
    const failed = payouts.filter((p) => p.status === 'failed').length;
    const pending = payouts.filter((p) => p.status === 'pending').length;
    const inProgress = payouts.filter((p) => p.status === 'in_progress').length;
    const recovered = payouts.filter((p) => p.status === 'recovered').length;

    const totalAttempts = payouts.reduce((sum, p) => sum + p.attempts.length, 0);
    const stuckPayouts = this.detectStuckPayouts().length;

    return {
      totalPayouts: payouts.length,
      confirmed,
      failed,
      pending,
      inProgress,
      recovered,
      successRate: payouts.length > 0 ? (confirmed / payouts.length) * 100 : 0,
      avgAttemptsPerPayout: payouts.length > 0 ? totalAttempts / payouts.length : 0,
      stuckPayouts,
    };
  }

  cleanup(): void {
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    for (const [id, payout] of this.payouts.entries()) {
      const age = now - payout.updatedAt;
      if ((payout.status === 'confirmed' || payout.status === 'failed') && age > thirtyDaysMs) {
        this.payouts.delete(id);
        this.idempotencyMap.delete(payout.idempotencyKey);

        const recipients = this.recipientIndex.get(payout.recipientAddress);
        if (recipients) {
          recipients.delete(id);
          if (recipients.size === 0) {
            this.recipientIndex.delete(payout.recipientAddress);
          }
        }
      }
    }
  }
}

export const payoutReliabilityService = new PayoutReliabilityService();
