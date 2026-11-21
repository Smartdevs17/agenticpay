import { describe, expect, it } from 'vitest';
import { ChurnPredictionService } from '../churn-prediction.js';

describe('ChurnPredictionService', () => {
  it('raises a retention intervention for repeated payment failures', () => {
    const service = new ChurnPredictionService();
    service.track({ customerId: 'customer-1', event: 'payment_failed', occurredAt: new Date('2026-01-01') });
    service.track({ customerId: 'customer-1', event: 'payment_failed', occurredAt: new Date('2026-01-02') });

    expect(service.predict('customer-1', new Date('2026-01-03'))).toMatchObject({
      score: 50,
      risk: 'medium',
      intervention: 'reminder',
      signals: ['payment_failed'],
    });
  });

  it('expires old signals and returns no intervention for an unknown customer', () => {
    const service = new ChurnPredictionService();
    service.track({ customerId: 'customer-1', event: 'cancelled', occurredAt: new Date('2025-01-01') });

    expect(service.predict('customer-1', new Date('2026-01-01'))).toMatchObject({
      score: 0,
      risk: 'low',
      intervention: 'none',
      signals: [],
    });
    expect(service.predict('unknown', new Date('2026-01-01')).score).toBe(0);
  });
});