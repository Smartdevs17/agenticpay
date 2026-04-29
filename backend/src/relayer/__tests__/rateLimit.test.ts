import { describe, it, expect } from 'vitest';
import { checkRelayRateLimit } from '../rateLimit.js';

const ADDR = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('checkRelayRateLimit', () => {
  it('allows requests within the limit', () => {
    const result = checkRelayRateLimit(ADDR + '_rl_test_1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
    expect(result.resetInSeconds).toBeGreaterThan(0);
  });

  it('blocks after exceeding the limit', () => {
    const addr = ADDR + '_rl_test_2';
    let last;
    for (let i = 0; i < 11; i++) {
      last = checkRelayRateLimit(addr);
    }
    expect(last!.allowed).toBe(false);
    expect(last!.remaining).toBe(0);
  });
});
