/**
 * payment-correctness.ts — Issue #1159
 *
 * Payment state validation and consistency checks to prevent payment
 * correctness bugs and state inconsistencies.
 */

export type PaymentState = 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

export interface PaymentRecord {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  state: PaymentState;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface PaymentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class PaymentCorrectnessService {
  private payments: Map<string, PaymentRecord> = new Map();
  private stateTransitions: Map<PaymentState, PaymentState[]> = new Map([
    ['pending', ['processing', 'cancelled']],
    ['processing', ['succeeded', 'failed', 'cancelled']],
    ['succeeded', []],
    ['failed', ['pending', 'cancelled']],
    ['cancelled', []],
  ]);

  validatePayment(payment: PaymentRecord): PaymentValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!payment.id || typeof payment.id !== 'string') {
      errors.push('Payment ID must be a non-empty string');
    }

    if (!payment.userId || typeof payment.userId !== 'string') {
      errors.push('User ID must be a non-empty string');
    }

    if (typeof payment.amount !== 'number' || payment.amount <= 0) {
      errors.push('Payment amount must be a positive number');
    }

    if (!payment.currency || typeof payment.currency !== 'string') {
      errors.push('Currency must be specified');
    }

    const validStates: PaymentState[] = ['pending', 'processing', 'succeeded', 'failed', 'cancelled'];
    if (!validStates.includes(payment.state)) {
      errors.push(`Payment state '${payment.state}' is invalid`);
    }

    if (payment.createdAt > payment.updatedAt) {
      errors.push('Created timestamp cannot be after updated timestamp');
    }

    if (payment.updatedAt > Date.now()) {
      warnings.push('Updated timestamp is in the future');
    }

    if (payment.state === 'succeeded' && !payment.metadata?.successAt) {
      warnings.push('Successful payment should have successAt timestamp in metadata');
    }

    if (payment.state === 'failed' && !payment.metadata?.failureReason) {
      warnings.push('Failed payment should have failureReason in metadata');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateStateTransition(fromState: PaymentState, toState: PaymentState): { valid: boolean; reason?: string } {
    const allowedTransitions = this.stateTransitions.get(fromState);

    if (!allowedTransitions) {
      return { valid: false, reason: `Unknown state: ${fromState}` };
    }

    if (!allowedTransitions.includes(toState)) {
      return {
        valid: false,
        reason: `Cannot transition from ${fromState} to ${toState}. Allowed: ${allowedTransitions.join(', ')}`,
      };
    }

    return { valid: true };
  }

  createPayment(
    id: string,
    userId: string,
    amount: number,
    currency: string,
    metadata?: Record<string, unknown>
  ): { success: boolean; payment?: PaymentRecord; error?: string } {
    const now = Date.now();
    const payment: PaymentRecord = {
      id,
      userId,
      amount,
      currency,
      state: 'pending',
      createdAt: now,
      updatedAt: now,
      metadata,
    };

    const validation = this.validatePayment(payment);
    if (!validation.valid) {
      return {
        success: false,
        error: `Payment validation failed: ${validation.errors.join('; ')}`,
      };
    }

    this.payments.set(id, payment);
    return { success: true, payment };
  }

  updatePaymentState(
    paymentId: string,
    newState: PaymentState,
    metadata?: Record<string, unknown>
  ): { success: boolean; payment?: PaymentRecord; error?: string } {
    const payment = this.payments.get(paymentId);

    if (!payment) {
      return { success: false, error: `Payment ${paymentId} not found` };
    }

    const transition = this.validateStateTransition(payment.state, newState);
    if (!transition.valid) {
      return { success: false, error: transition.reason };
    }

    payment.state = newState;
    payment.updatedAt = Date.now();

    if (metadata) {
      payment.metadata = { ...payment.metadata, ...metadata };
    }

    if (newState === 'succeeded') {
      payment.metadata = { ...payment.metadata, successAt: Date.now() };
    } else if (newState === 'failed') {
      payment.metadata = { ...payment.metadata, failureAt: Date.now() };
    }

    this.payments.set(paymentId, payment);
    return { success: true, payment };
  }

  getPayment(paymentId: string): PaymentRecord | undefined {
    return this.payments.get(paymentId);
  }

  getPaymentsByUser(userId: string): PaymentRecord[] {
    return Array.from(this.payments.values()).filter((p) => p.userId === userId);
  }

  getPaymentsByState(state: PaymentState): PaymentRecord[] {
    return Array.from(this.payments.values()).filter((p) => p.state === state);
  }

  validatePaymentChain(paymentIds: string[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const id of paymentIds) {
      const payment = this.payments.get(id);
      if (!payment) {
        errors.push(`Payment ${id} not found`);
        continue;
      }

      const validation = this.validatePayment(payment);
      if (!validation.valid) {
        errors.push(`Payment ${id}: ${validation.errors.join('; ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  getConsistencyReport(): {
    totalPayments: number;
    byState: Record<PaymentState, number>;
    inconsistencies: string[];
  } {
    const payments = Array.from(this.payments.values());
    const byState: Record<PaymentState, number> = {
      pending: 0,
      processing: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };

    const inconsistencies: string[] = [];

    for (const payment of payments) {
      byState[payment.state]++;

      const validation = this.validatePayment(payment);
      if (!validation.valid) {
        inconsistencies.push(`${payment.id}: ${validation.errors.join('; ')}`);
      }
    }

    return {
      totalPayments: payments.length,
      byState,
      inconsistencies,
    };
  }

  cleanup(): void {
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    for (const [id, payment] of this.payments.entries()) {
      const age = now - payment.updatedAt;
      if (payment.state === 'succeeded' || payment.state === 'failed' || payment.state === 'cancelled') {
        if (age > thirtyDaysMs) {
          this.payments.delete(id);
        }
      }
    }
  }
}

export const paymentCorrectnessService = new PaymentCorrectnessService();
