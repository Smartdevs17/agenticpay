/**
 * CrossBorderPaymentService tests — Issue #920
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CrossBorderPaymentService, type RateProvider } from '../cross-border/cross-border-service.js';

const RATES: Record<string, number> = {
  'USD:EUR': 0.9,
  'EUR:USD': 1 / 0.9,
  'USD:XLM': 10,
};

const rateProvider: RateProvider = {
  async getRate(base, quote) {
    const rate = RATES[`${base}:${quote}`] ?? 1;
    const now = new Date();
    return {
      ok: true,
      value: {
        rate,
        baseCurrency: base,
        quoteCurrency: quote,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      },
    };
  },
};

let currentTime = Date.parse('2026-01-01T00:00:00.000Z');
const clock = () => new Date(currentTime);

function makeService(quoteTtlMs = 120_000) {
  return new CrossBorderPaymentService({ fx: rateProvider, now: clock, quoteTtlMs });
}

describe('cross-border corridors', () => {
  it('exposes both directions for every seeded corridor', () => {
    const service = makeService();
    const corridors = service.listCorridors();

    expect(corridors).toHaveLength(12);
    expect(service.getCorridor('USD', 'EUR')).toMatchObject({ rail: 'sepa', fxFeePct: 0.005 });
    expect(service.getCorridor('EUR', 'USD')).toMatchObject({ rail: 'ach' });
    expect(service.getCorridor('USD', 'XLM')).toMatchObject({ rail: 'stellar' });
  });

  it('returns undefined for unsupported pairs', () => {
    expect(makeService().getCorridor('USD', 'JPY')).toBeUndefined();
  });
});

describe('createQuote', () => {
  let service: CrossBorderPaymentService;

  beforeEach(() => {
    currentTime = Date.parse('2026-01-01T00:00:00.000Z');
    service = makeService();
  });

  it('prices a source-amount quote with FX and fixed fees', async () => {
    const result = await service.createQuote({ amount: 100, sourceCurrency: 'usd', targetCurrency: 'eur' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      corridorId: 'USD:EUR',
      sourceCurrency: 'USD',
      targetCurrency: 'EUR',
      sourceAmount: 100,
      rate: 0.9,
      convertibleAmount: 98,
      fees: { fxFee: 0.5, fixedFee: 1.5, total: 2 },
      targetAmount: 88.2,
    });
    expect(result.value.expiresAt.getTime()).toBeGreaterThan(result.value.createdAt.getTime());
  });

  it('solves the source amount in target mode so the recipient receives the requested amount', async () => {
    const result = await service.createQuote({
      amount: 90,
      sourceCurrency: 'USD',
      targetCurrency: 'EUR',
      mode: 'target',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe('target');
    expect(result.value.targetAmount).toBe(90);
    expect(result.value.sourceAmount).toBe(102.01);
    expect(result.value.fees.total).toBe(2.01);
  });

  it('rejects unsupported corridors', async () => {
    const result = await service.createQuote({ amount: 100, sourceCurrency: 'USD', targetCurrency: 'JPY' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CORRIDOR_NOT_SUPPORTED');
    expect(result.error.statusCode).toBe(422);
  });

  it('rejects same-currency transfers', async () => {
    const result = await service.createQuote({ amount: 100, sourceCurrency: 'USD', targetCurrency: 'USD' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('enforces corridor amount limits', async () => {
    const tooSmall = await service.createQuote({ amount: 5, sourceCurrency: 'USD', targetCurrency: 'EUR' });
    expect(tooSmall.ok).toBe(false);
    if (!tooSmall.ok) expect(tooSmall.error.code).toBe('AMOUNT_OUT_OF_RANGE');

    const tooLarge = await service.createQuote({ amount: 2_000_000, sourceCurrency: 'USD', targetCurrency: 'EUR' });
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.error.code).toBe('AMOUNT_OUT_OF_RANGE');
  });

  it('rejects non-positive and non-finite amounts', async () => {
    for (const amount of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await service.createQuote({ amount, sourceCurrency: 'USD', targetCurrency: 'EUR' });
      expect(result.ok).toBe(false);
    }
  });

  it('returns not-found for unknown quotes', () => {
    const result = service.getQuote('does-not-exist');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.statusCode).toBe(404);
  });
});

describe('cross-border payments', () => {
  let service: CrossBorderPaymentService;

  beforeEach(() => {
    currentTime = Date.parse('2026-01-01T00:00:00.000Z');
    service = makeService();
  });

  async function quote(amount = 100) {
    const result = await service.createQuote({ amount, sourceCurrency: 'USD', targetCurrency: 'EUR' });
    if (!result.ok) throw new Error('quote failed');
    return result.value;
  }

  it('initiates a processing payment from a quote', async () => {
    const q = await quote();
    const result = await service.initiatePayment({ quoteId: q.id, senderId: 's1', recipientId: 'r1' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      status: 'processing',
      senderId: 's1',
      recipientId: 'r1',
      sourceAmount: 100,
      targetAmount: 88.2,
      corridorId: 'USD:EUR',
    });
  });

  it('is idempotent when an idempotency key is reused', async () => {
    const q = await quote();
    const first = await service.initiatePayment({
      quoteId: q.id,
      senderId: 's1',
      recipientId: 'r1',
      idempotencyKey: 'pay-1',
    });
    const second = await service.initiatePayment({
      quoteId: q.id,
      senderId: 's1',
      recipientId: 'r1',
      idempotencyKey: 'pay-1',
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.id).toBe(first.value.id);

    const all = service.listPayments();
    expect(all.ok && all.value).toHaveLength(1);
  });

  it('rejects expired quotes with a conflict', async () => {
    const q = await quote();
    currentTime += 120_001;

    const result = await service.initiatePayment({ quoteId: q.id, senderId: 's1', recipientId: 'r1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('QUOTE_EXPIRED');
  });

  it('requires sender and recipient ids', async () => {
    const q = await quote();
    const result = await service.initiatePayment({ quoteId: q.id, senderId: '', recipientId: 'r1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('completes a payment and blocks invalid transitions', async () => {
    const q = await quote();
    const initiated = await service.initiatePayment({ quoteId: q.id, senderId: 's1', recipientId: 'r1' });
    if (!initiated.ok) throw new Error('initiate failed');

    const completed = service.completePayment(initiated.value.id, { txHash: '0xabc' });
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.value.status).toBe('completed');
      expect(completed.value.txHash).toBe('0xabc');
      expect(completed.value.completedAt).toBeInstanceOf(Date);
    }

    const again = service.failPayment(initiated.value.id, 'late failure');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.statusCode).toBe(409);
  });

  it('fails a payment with a reason', async () => {
    const q = await quote();
    const initiated = await service.initiatePayment({ quoteId: q.id, senderId: 's1', recipientId: 'r1' });
    if (!initiated.ok) throw new Error('initiate failed');

    const failed = service.failPayment(initiated.value.id, 'rail rejected');
    expect(failed.ok).toBe(true);
    if (failed.ok) {
      expect(failed.value.status).toBe('failed');
      expect(failed.value.failureReason).toBe('rail rejected');
    }
  });

  it('filters payments and reports missing ones', async () => {
    const q1 = await quote(100);
    const q2 = await quote(200);
    const p1 = await service.initiatePayment({ quoteId: q1.id, senderId: 's1', recipientId: 'r1' });
    await service.initiatePayment({ quoteId: q2.id, senderId: 's2', recipientId: 'r2' });
    if (!p1.ok) throw new Error('initiate failed');
    service.completePayment(p1.value.id);

    const bySender = service.listPayments({ senderId: 's1' });
    expect(bySender.ok && bySender.value).toHaveLength(1);

    const completed = service.listPayments({ status: 'completed' });
    expect(completed.ok && completed.value).toHaveLength(1);

    const missing = service.getPayment('nope');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.statusCode).toBe(404);
  });
});
