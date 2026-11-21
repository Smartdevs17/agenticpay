import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyRequestSignature } from '../payout-security.js';

describe('payout request signatures', () => {
  const payload = JSON.stringify({ merchantId: 'm1', amount: 25 });
  const secret = 'test-secret';

  it('accepts an HMAC-SHA256 signature, including the sha256= prefix', () => {
    const digest = createHmac('sha256', secret).update(payload).digest('hex');

    expect(verifyRequestSignature(payload, digest, secret)).toBe(true);
    expect(verifyRequestSignature(payload, `sha256=${digest}`, secret)).toBe(true);
  });

  it('rejects tampered payloads, secrets, and malformed signatures', () => {
    const digest = createHmac('sha256', secret).update(payload).digest('hex');

    expect(verifyRequestSignature(`${payload}.tampered`, digest, secret)).toBe(false);
    expect(verifyRequestSignature(payload, digest, 'wrong-secret')).toBe(false);
    expect(verifyRequestSignature(payload, 'not-a-signature', secret)).toBe(false);
  });
});
