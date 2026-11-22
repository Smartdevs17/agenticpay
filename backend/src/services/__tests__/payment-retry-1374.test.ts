import { describe, expect, it } from 'vitest';
import {
  calculateRetryDelayMs,
  MAX_ATTEMPTS_DEFAULT,
  PaymentRetryService,
} from '../paymentRetry.js';

describe('payment retry engine (#1374)', () => {
  it('adds bounded jitter without exceeding the poison cap', () => {
    expect(calculateRetryDelayMs('next_day', 1, () => 0)).toBe(19_200_000);
    expect(calculateRetryDelayMs('next_day', 1, () => 1)).toBe(28_800_000);
    expect(calculateRetryDelayMs('next_day', 99, () => 1)).toBeLessThanOrEqual(
      30 * 24 * 60 * 60 * 1_000,
    );
  });

  it('moves to the next fallback method after a retryable failure', () => {
    const service = new PaymentRetryService();
    const created = service.createRetry({
      paymentId: 'payment-1374', userId: 'user-1374', amount: 10, currency: 'USD',
      failureReason: 'network timeout', paymentMethodIds: ['card-a', 'card-b'],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const attempt = service.executeRetry(created.value.id);
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;
    const outcome = service.recordAttemptOutcome(created.value.id, attempt.value.id, {
      success: false, failureReason: 'network timeout',
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.currentPaymentMethodIndex).toBe(1);
      expect(outcome.value.currentAttemptNumber).toBe(1);
    }
  });

  it('abandons a poison payment at the attempt cap', () => {
    const service = new PaymentRetryService();
    const created = service.createRetry({
      paymentId: 'payment-poison-1374', userId: 'user-poison-1374', amount: 10, currency: 'USD',
      failureReason: 'network timeout', paymentMethodIds: ['card-a'],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    for (let i = 0; i < MAX_ATTEMPTS_DEFAULT; i += 1) {
      const attempt = service.executeRetry(created.value.id);
      expect(attempt.ok).toBe(true);
      if (!attempt.ok) return;
      service.recordAttemptOutcome(created.value.id, attempt.value.id, {
        success: false, failureReason: 'network timeout',
      });
    }
    expect(service.executeRetry(created.value.id).ok).toBe(false);
    const stored = service.getRetry(created.value.id);
    expect(stored.ok).toBe(true);
    if (stored.ok) expect(stored.value.status).toBe('abandoned');
  });
});
