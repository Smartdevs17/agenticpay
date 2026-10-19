import { describe, it, expect, vi } from 'vitest';

const refundMock = vi.fn(async () => ({ id: 're_1' }));

vi.mock('../stripe.js', () => ({
  getStripe: () => ({ refunds: { create: refundMock } }),
}));

const {
  convertFiatToCrypto,
  getConversion,
  getRate,
  isSupportedFiatPair,
  lockRate,
  confirmConversion,
  processFiatRefund,
  settleToStellar,
} = await import('../fiat-crypto.js');

const USER_A = 'user_a';
const USER_B = 'user_b';

describe('fiat-crypto conversions', () => {
  it('ties a confirmed conversion to the user who locked the rate', async () => {
    const lock = await lockRate(USER_A, 'USD', 'USDC', 100);
    const conversion = await confirmConversion(lock.id, USER_A, 'pi_123');
    expect(conversion.userId).toBe(USER_A);
  });

  it('rejects confirming a rate lock that belongs to a different user', async () => {
    const lock = await lockRate(USER_A, 'USD', 'USDC', 100);
    await expect(confirmConversion(lock.id, USER_B, 'pi_123')).rejects.toThrow();
  });

  it('rejects confirming the same rate lock twice, even for its own owner', async () => {
    const lock = await lockRate(USER_A, 'USD', 'USDC', 100);
    const first = await confirmConversion(lock.id, USER_A, 'pi_first');
    await expect(confirmConversion(lock.id, USER_A, 'pi_second')).rejects.toThrow(
      'Rate lock has already been used',
    );

    // Only the first confirmation produced a conversion.
    const stored = await getConversion(first.id);
    expect(stored?.stripePaymentIntentId).toBe('pi_first');
  });
});

describe('fiat-crypto rate quotes', () => {
  it('refuses to quote a pair it has no rate for', async () => {
    expect(() => getRate('GBP', 'BTC')).toThrow('UNSUPPORTED_FIAT_PAIR');
    await expect(lockRate(USER_A, 'GBP', 'BTC', 100)).rejects.toThrow('UNSUPPORTED_FIAT_PAIR');
  });

  it('does not silently price an unknown pair at par', () => {
    // Previously an unlisted pair fell through to 1.0, pricing 1 BTC per GBP.
    expect(() => getRate('JPY', 'XLM')).toThrow('UNSUPPORTED_FIAT_PAIR');
    expect(isSupportedFiatPair('JPY', 'XLM')).toBe(false);
    expect(isSupportedFiatPair('usd', 'usdc')).toBe(true);
  });
});

describe('fiat-crypto amount validation', () => {
  it.each([
    ['zero', 0],
    ['negative', -10],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s amount', async (_label, amount) => {
    await expect(lockRate(USER_A, 'USD', 'USDC', amount)).rejects.toThrow('INVALID_CONVERSION_AMOUNT');
  });

  it('rejects an amount above the single-conversion cap', async () => {
    await expect(lockRate(USER_A, 'USD', 'USDC', 100_001)).rejects.toThrow('CONVERSION_AMOUNT_EXCEEDED');
  });

  it('normalises a sub-cent amount before locking a rate', async () => {
    const lock = await lockRate(USER_A, 'USD', 'USDC', 10.005);
    expect(lock.amount).toBe(10.01);
  });

  it('rejects a lock with no owner', async () => {
    await expect(lockRate('', 'USD', 'USDC', 10)).rejects.toThrow('INVALID_USER_ID');
  });
});

describe('fiat-crypto conversion arithmetic', () => {
  it('applies the rate exactly instead of accumulating float drift', async () => {
    const lock = await lockRate(USER_A, 'EUR', 'USDC', 33.33);
    const conversion = await confirmConversion(lock.id, USER_A, 'pi_1');

    // 33.33 * 1.08 === 35.99640000000001 as a double.
    expect(33.33 * 1.08).not.toBe(35.9964);
    expect(conversion.cryptoAmount).toBe('35.9964000');
  });

  it('exposes the same conversion through the shared helper', () => {
    expect(convertFiatToCrypto(100, 1.26)).toBe('126.0000000');
    expect(convertFiatToCrypto(0.01, 0.5, 2)).toBe('0.01');
  });
});

describe('fiat-crypto refunds', () => {
  it('records a refund distinctly from a conversion failure', async () => {
    refundMock.mockClear();
    const lock = await lockRate(USER_A, 'USD', 'USDC', 100);
    const conversion = await confirmConversion(lock.id, USER_A, 'pi_refund');

    expect(await processFiatRefund(conversion.id)).toBe(true);
    expect((await getConversion(conversion.id))?.status).toBe('refunded');
    expect((await getConversion(conversion.id))?.refundedAt).toBeTypeOf('number');
  });

  it('does not refund a conversion twice', async () => {
    refundMock.mockClear();
    const lock = await lockRate(USER_A, 'USD', 'USDC', 100);
    const conversion = await confirmConversion(lock.id, USER_A, 'pi_twice');

    expect(await processFiatRefund(conversion.id)).toBe(true);
    expect(await processFiatRefund(conversion.id)).toBe(false);
    expect(refundMock).toHaveBeenCalledTimes(1);
  });
});

describe('fiat-crypto stellar settlement', () => {
  const destination = 'G'.concat('A'.repeat(55));

  it('derives a deterministic transaction reference', async () => {
    const first = await settleToStellar(destination, '12.5000000', 'USDC');
    const second = await settleToStellar(destination, '12.5000000', 'USDC');
    expect(first).toBe(second);
    expect(first).toMatch(/^stellar_[0-9a-f]{32}$/);
  });

  it('changes the reference when the amount changes', async () => {
    const first = await settleToStellar(destination, '12.5000000', 'USDC');
    const second = await settleToStellar(destination, '12.5000001', 'USDC');
    expect(first).not.toBe(second);
  });

  it('rejects a malformed destination address', async () => {
    await expect(settleToStellar('not-an-address', '12.5', 'USDC')).rejects.toThrow(
      'INVALID_DESTINATION_ADDRESS',
    );
  });

  it.each([['0'], ['-1'], ['abc']])('rejects an unusable settlement amount %s', async (amount) => {
    await expect(settleToStellar(destination, amount, 'USDC')).rejects.toThrow('INVALID_SETTLEMENT_AMOUNT');
  });
});

describe('fiat-crypto snapshot isolation', () => {
  it('does not let a caller mutate a stored conversion', async () => {
    const lock = await lockRate(USER_A, 'USD', 'USDC', 100);
    const conversion = await confirmConversion(lock.id, USER_A, 'pi_snap');

    const snapshot = await getConversion(conversion.id);
    snapshot!.status = 'failed';
    snapshot!.cryptoAmount = '999';

    const stored = await getConversion(conversion.id);
    expect(stored?.status).toBe('completed');
    expect(stored?.cryptoAmount).toBe('100.0000000');
  });
});