import { describe, it, expect, beforeEach } from 'vitest';
import { isNonceUsed, markNonceUsed, pruneExpiredNonces } from '../nonce.js';

const ADDR = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('nonce store', () => {
  it('returns false for an unused nonce', () => {
    expect(isNonceUsed(ADDR, 9999)).toBe(false);
  });

  it('returns true after marking a nonce used', () => {
    markNonceUsed(ADDR, 42);
    expect(isNonceUsed(ADDR, 42)).toBe(true);
  });

  it('does not affect other nonces', () => {
    markNonceUsed(ADDR, 100);
    expect(isNonceUsed(ADDR, 101)).toBe(false);
  });

  it('pruneExpiredNonces runs without error', () => {
    expect(() => pruneExpiredNonces()).not.toThrow();
  });
});
