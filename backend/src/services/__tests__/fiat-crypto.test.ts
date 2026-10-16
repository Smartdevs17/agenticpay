import { describe, it, expect } from 'vitest';
import { lockRate, confirmConversion, getConversion } from '../fiat-crypto.js';

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
