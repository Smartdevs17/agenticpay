/**
 * Comprehensive Webhook Signature Verification Tests
 * Issue #807 — Expanded coverage for webhook signature verification
 *
 * Covers:
 *  1. HMAC signature generation
 *  2. Signature verification — success paths
 *  3. Signature verification — failure paths
 *  4. Replay protection (timestamp tolerance)
 *  5. Secret management (create, rotate, deactivate)
 *  6. Event queue management (queue, retry, mark processed)
 *  7. Constant-time comparison (timing attack prevention)
 *  8. Multiple provider isolation
 */

import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateWebhookSignature,
  verifyWebhookSignature,
  createWebhookSecret,
  getActiveSecretForProvider,
  getActiveSecretsForProvider,
  rotateWebhookSecret,
  deactivateWebhookSecret,
  getAllWebhookSecrets,
  queueFailedWebhook,
  getQueuedWebhooks,
  retryWebhook,
  markWebhookProcessed,
  getWebhookEvents,
  clearWebhookEvents,
  clearWebhookSecrets,
  WebhookProvider,
  WebhookSecret,
} from '../webhooks/verification';

// ---------------------------------------------------------------------------
// Shared test constants
// ---------------------------------------------------------------------------

const SECRET = 'whsec_test_comprehensive_secret_key_32_chars_minimum';
const PAYLOAD = JSON.stringify({ event: 'payment.created', data: { id: 'evt_001', amount: 5000 } });
const NOW_ISO = new Date().toISOString();

/** Returns an ISO timestamp that is `offsetMs` milliseconds away from now. */
function tsOffset(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// 1. HMAC Signature Generation
// ---------------------------------------------------------------------------

describe('1. HMAC Signature Generation', () => {
  beforeEach(() => {
    clearWebhookSecrets();
    clearWebhookEvents();
  });

  it('produces consistent signatures for identical inputs', () => {
    const sig1 = generateWebhookSignature(PAYLOAD, SECRET, NOW_ISO);
    const sig2 = generateWebhookSignature(PAYLOAD, SECRET, NOW_ISO);
    expect(sig1).toBe(sig2);
  });

  it('output is a 64-character lowercase hex string (SHA-256)', () => {
    const sig = generateWebhookSignature(PAYLOAD, SECRET, NOW_ISO);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it('message format is "{timestamp}.{payload}"', () => {
    const timestamp = '2026-01-01T00:00:00.000Z';
    const payload = 'hello_world';
    const expected = createHmac('sha256', SECRET)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    expect(generateWebhookSignature(payload, SECRET, timestamp)).toBe(expected);
  });

  it('different payload produces different signature', () => {
    const sig1 = generateWebhookSignature(PAYLOAD, SECRET, NOW_ISO);
    const sig2 = generateWebhookSignature('different payload', SECRET, NOW_ISO);
    expect(sig1).not.toBe(sig2);
  });

  it('different secret produces different signature', () => {
    const sig1 = generateWebhookSignature(PAYLOAD, SECRET, NOW_ISO);
    const sig2 = generateWebhookSignature(PAYLOAD, 'whsec_another_totally_different_secret_key_xyz', NOW_ISO);
    expect(sig1).not.toBe(sig2);
  });

  it('different timestamp produces different signature', () => {
    const sig1 = generateWebhookSignature(PAYLOAD, SECRET, NOW_ISO);
    const sig2 = generateWebhookSignature(PAYLOAD, SECRET, '2020-06-15T12:00:00.000Z');
    expect(sig1).not.toBe(sig2);
  });
});

// ---------------------------------------------------------------------------
// 2. Signature Verification — Success Paths
// ---------------------------------------------------------------------------

describe('2. Signature Verification — Success Paths', () => {
  beforeEach(() => {
    clearWebhookSecrets();
    clearWebhookEvents();
  });

  it('valid signature verifies correctly', () => {
    const ts = tsOffset(-5_000); // 5 seconds ago — well within tolerance
    const sig = generateWebhookSignature(PAYLOAD, SECRET, ts);
    createWebhookSecret('stripe', SECRET);

    const result = verifyWebhookSignature({
      signature: sig,
      timestamp: ts,
      body: PAYLOAD,
      provider: 'stripe',
    });

    expect(result.isValid).toBe(true);
    expect(result.provider).toBe('stripe');
    expect(result.error).toBeUndefined();
    expect(result.timestamp).toEqual(new Date(ts));
  });

  it('key rotation: verifies against each active secret', () => {
    const ts = tsOffset(-3_000);
    const secret1 = 'whsec_rotation_key_one_at_least_32_characters_long';
    const secret2 = 'whsec_rotation_key_two_at_least_32_characters_long';

    // Two active secrets simultaneously (overlap window during rotation)
    createWebhookSecret('paypal', secret1);
    createWebhookSecret('paypal', secret2);

    // Signature made with secret1 should still verify
    const sig1 = generateWebhookSignature(PAYLOAD, secret1, ts);
    const res1 = verifyWebhookSignature({ signature: sig1, timestamp: ts, body: PAYLOAD, provider: 'paypal' });
    expect(res1.isValid).toBe(true);

    // Signature made with secret2 should also verify
    const sig2 = generateWebhookSignature(PAYLOAD, secret2, ts);
    const res2 = verifyWebhookSignature({ signature: sig2, timestamp: ts, body: PAYLOAD, provider: 'paypal' });
    expect(res2.isValid).toBe(true);
  });

  it('expired secrets are NOT used for verification', () => {
    const ts = tsOffset(-3_000);
    // Create a secret that expired in the past
    const expiredAt = new Date(Date.now() - 60_000).toISOString(); // expired 1 min ago
    createWebhookSecret('github', SECRET, expiredAt);

    // No active (unexpired) secret exists — verification must fail
    const sig = generateWebhookSignature(PAYLOAD, SECRET, ts);
    const result = verifyWebhookSignature({ signature: sig, timestamp: ts, body: PAYLOAD, provider: 'github' });
    expect(result.isValid).toBe(false);
  });

  it('keyId filtering: only secrets with matching keyId are used', () => {
    const ts = tsOffset(-3_000);
    const secretA = 'whsec_keyid_secret_A_at_least_32_characters_xxxxx';
    const secretB = 'whsec_keyid_secret_B_at_least_32_characters_xxxxx';

    createWebhookSecret('custom', secretA, undefined, 'key_A');
    createWebhookSecret('custom', secretB, undefined, 'key_B');

    // Sign with secretA and specify keyId=key_A
    const sigA = generateWebhookSignature(PAYLOAD, secretA, ts);
    const resultA = verifyWebhookSignature({
      signature: sigA,
      timestamp: ts,
      body: PAYLOAD,
      provider: 'custom',
      keyId: 'key_A',
    });
    expect(resultA.isValid).toBe(true);

    // Sign with secretA but request keyId=key_B — must fail
    const resultB = verifyWebhookSignature({
      signature: sigA,
      timestamp: ts,
      body: PAYLOAD,
      provider: 'custom',
      keyId: 'key_B',
    });
    expect(resultB.isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Signature Verification — Failure Paths
// ---------------------------------------------------------------------------

describe('3. Signature Verification — Failure Paths', () => {
  beforeEach(() => {
    clearWebhookSecrets();
    clearWebhookEvents();
  });

  it('invalid signature returns isValid=false with error message', () => {
    createWebhookSecret('stripe', SECRET);

    const result = verifyWebhookSignature({
      signature: 'deadbeef00000000000000000000000000000000000000000000000000000000',
      timestamp: tsOffset(-1_000),
      body: PAYLOAD,
      provider: 'stripe',
    });

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('verification failed');
  });

  it('no active secrets returns error message', () => {
    // No secret created for github
    const result = verifyWebhookSignature({
      signature: 'a'.repeat(64),
      timestamp: tsOffset(-1_000),
      body: PAYLOAD,
      provider: 'github',
    });

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('No active secret found');
  });

  it('timestamp far in the past (replay attack) is rejected', () => {
    createWebhookSecret('stripe', SECRET);
    const oldTs = '2020-01-01T00:00:00.000Z';
    const sig = generateWebhookSignature(PAYLOAD, SECRET, oldTs);

    const result = verifyWebhookSignature({
      signature: sig,
      timestamp: oldTs,
      body: PAYLOAD,
      provider: 'stripe',
      toleranceSeconds: 300,
    });

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('outside tolerance window');
  });

  it('timestamp far in the future is rejected', () => {
    createWebhookSecret('stripe', SECRET);
    const futureTs = tsOffset(10 * 60 * 1000); // 10 minutes ahead
    const sig = generateWebhookSignature(PAYLOAD, SECRET, futureTs);

    const result = verifyWebhookSignature({
      signature: sig,
      timestamp: futureTs,
      body: PAYLOAD,
      provider: 'stripe',
      toleranceSeconds: 300, // 5 min tolerance
    });

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('outside tolerance window');
  });

  it('timestamp slightly in the future within tolerance is accepted', () => {
    createWebhookSecret('stripe', SECRET);
    // 30 seconds ahead — within 5-minute default tolerance
    const slightFutureTs = tsOffset(30_000);
    const sig = generateWebhookSignature(PAYLOAD, SECRET, slightFutureTs);

    const result = verifyWebhookSignature({
      signature: sig,
      timestamp: slightFutureTs,
      body: PAYLOAD,
      provider: 'stripe',
      toleranceSeconds: 300,
    });

    expect(result.isValid).toBe(true);
  });

  it('empty signature string is rejected', () => {
    createWebhookSecret('stripe', SECRET);

    const result = verifyWebhookSignature({
      signature: '',
      timestamp: tsOffset(-1_000),
      body: PAYLOAD,
      provider: 'stripe',
    });

    expect(result.isValid).toBe(false);
  });

  it('malformed/short signature string is rejected', () => {
    createWebhookSecret('stripe', SECRET);

    const result = verifyWebhookSignature({
      signature: 'abc123',
      timestamp: tsOffset(-1_000),
      body: PAYLOAD,
      provider: 'stripe',
    });

    expect(result.isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Replay Protection — Boundary Conditions
// ---------------------------------------------------------------------------

describe('4. Replay Protection — Boundary Conditions', () => {
  beforeEach(() => {
    clearWebhookSecrets();
    clearWebhookEvents();
  });

  it('timestamp well within tolerance boundary passes', () => {
    createWebhookSecret('stripe', SECRET);
    const TOLERANCE_S = 300;
    // Use a timestamp 1 second inside the boundary to avoid timing flakiness
    // (the service checks timeDiff > toleranceMs, so exactly at the boundary
    // could fail if a few ms elapse between timestamp creation and check)
    const withinTs = tsOffset(-((TOLERANCE_S - 1) * 1000));
    const sig = generateWebhookSignature(PAYLOAD, SECRET, withinTs);

    const result = verifyWebhookSignature({
      signature: sig,
      timestamp: withinTs,
      body: PAYLOAD,
      provider: 'stripe',
      toleranceSeconds: TOLERANCE_S,
    });

    // 1s inside boundary is NOT > toleranceMs, so it should pass
    expect(result.isValid).toBe(true);
  });

  it('timestamp 1 second beyond tolerance is rejected', () => {
    createWebhookSecret('stripe', SECRET);
    const TOLERANCE_S = 60;
    const beyondTs = tsOffset(-((TOLERANCE_S + 1) * 1000));
    const sig = generateWebhookSignature(PAYLOAD, SECRET, beyondTs);

    const result = verifyWebhookSignature({
      signature: sig,
      timestamp: beyondTs,
      body: PAYLOAD,
      provider: 'stripe',
      toleranceSeconds: TOLERANCE_S,
    });

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('outside tolerance window');
  });

  it('custom toleranceSeconds is respected (short window)', () => {
    createWebhookSecret('stripe', SECRET);
    // 30 seconds ago — fine for 300s tolerance but out of range for 10s tolerance
    const ts = tsOffset(-30_000);
    const sig = generateWebhookSignature(PAYLOAD, SECRET, ts);

    const tight = verifyWebhookSignature({
      signature: sig,
      timestamp: ts,
      body: PAYLOAD,
      provider: 'stripe',
      toleranceSeconds: 10,
    });
    expect(tight.isValid).toBe(false);

    const loose = verifyWebhookSignature({
      signature: sig,
      timestamp: ts,
      body: PAYLOAD,
      provider: 'stripe',
      toleranceSeconds: 300,
    });
    expect(loose.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Secret Management
// ---------------------------------------------------------------------------

describe('5. Secret Management', () => {
  beforeEach(() => {
    clearWebhookSecrets();
    clearWebhookEvents();
  });

  it('createWebhookSecret stores and returns id, keyId, provider', () => {
    const secret = createWebhookSecret('stripe', SECRET);
    expect(secret.id).toMatch(/^whs_/);
    expect(secret.keyId).toBeDefined();
    expect(secret.provider).toBe('stripe');
    expect(secret.secret).toBe(SECRET);
    expect(secret.isActive).toBe(true);
    expect(secret.createdAt).toBeDefined();
  });

  it('getActiveSecretForProvider returns the newest active secret', async () => {
    createWebhookSecret('stripe', 'whsec_older_secret_at_least_32_characters_xxxxxxxx');
    // Wait 2ms to guarantee a strictly greater Date.now() for the second secret
    await new Promise(resolve => setTimeout(resolve, 2));
    const newer = createWebhookSecret('stripe', 'whsec_newer_secret_at_least_32_characters_xxxxxxxx');

    const active = getActiveSecretForProvider('stripe');
    expect(active?.id).toBe(newer.id);
  });

  it('getActiveSecretsForProvider returns all active secrets sorted newest first', () => {
    const s1 = createWebhookSecret('paypal', 'whsec_paypal_secret_one_minimum_32_characters_xxxx');
    const s2 = createWebhookSecret('paypal', 'whsec_paypal_secret_two_minimum_32_characters_xxxx');
    const s3 = createWebhookSecret('paypal', 'whsec_paypal_secret_three_minimum_32_chars_xxxxxx');

    const active = getActiveSecretsForProvider('paypal');
    expect(active.length).toBe(3);
    // Sorted newest first
    expect(new Date(active[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(active[1].createdAt).getTime()
    );
    expect(new Date(active[1].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(active[2].createdAt).getTime()
    );
    // All active
    expect(active.every(s => s.isActive)).toBe(true);
    // IDs present
    const ids = active.map(s => s.id);
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);
    expect(ids).toContain(s3.id);
  });

  it('rotateWebhookSecret deactivates old secrets and creates a new one', () => {
    const old = createWebhookSecret('github', SECRET);
    const newSecretValue = 'whsec_rotated_github_secret_at_least_32_chars_xxx';
    const rotated = rotateWebhookSecret('github', newSecretValue, 24);

    expect(rotated.isActive).toBe(true);
    expect(rotated.secret).toBe(newSecretValue);
    expect(rotated.provider).toBe('github');

    const storedOld = getAllWebhookSecrets().find(s => s.id === old.id);
    expect(storedOld?.isActive).toBe(false);
  });

  it('rotated old secret has an expiresAt grace period set', () => {
    const old = createWebhookSecret('github', SECRET);
    const gracePeriodHours = 12;
    rotateWebhookSecret('github', 'whsec_rotated_secret_minimum_32_chars_xxxxxxxxxx', gracePeriodHours);

    const storedOld = getAllWebhookSecrets().find(s => s.id === old.id);
    expect(storedOld?.expiresAt).toBeDefined();
    const expiresAt = new Date(storedOld!.expiresAt!).getTime();
    const expectedExpiry = Date.now() + gracePeriodHours * 60 * 60 * 1000;
    // Allow ±5 seconds of drift
    expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(5_000);
  });

  it('deactivateWebhookSecret marks secret as inactive', () => {
    const secret = createWebhookSecret('custom', SECRET);
    const success = deactivateWebhookSecret(secret.id);

    expect(success).toBe(true);
    const stored = getAllWebhookSecrets().find(s => s.id === secret.id);
    expect(stored?.isActive).toBe(false);

    const active = getActiveSecretForProvider('custom');
    expect(active).toBeNull();
  });

  it('deactivateWebhookSecret returns false for unknown id', () => {
    const result = deactivateWebhookSecret('whs_nonexistent_id_00000000');
    expect(result).toBe(false);
  });

  it('getAllWebhookSecrets returns all secrets (active and inactive)', () => {
    const s1 = createWebhookSecret('stripe', SECRET);
    const s2 = createWebhookSecret('paypal', 'whsec_paypal_all_secrets_test_at_least_32_chars');
    deactivateWebhookSecret(s1.id);

    const all = getAllWebhookSecrets();
    const ids = all.map(s => s.id);
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);
  });
});

// ---------------------------------------------------------------------------
// 6. Event Queue Management
// ---------------------------------------------------------------------------

describe('6. Event Queue Management', () => {
  beforeEach(() => {
    clearWebhookSecrets();
    clearWebhookEvents();
  });

  it('queueFailedWebhook creates event with retryCount=0', () => {
    const event = queueFailedWebhook('stripe', 'charge.failed', { id: 'ch_1' }, 'bad_sig', NOW_ISO, 'Sig mismatch');

    expect(event.id).toMatch(/^whe_/);
    expect(event.provider).toBe('stripe');
    expect(event.eventType).toBe('charge.failed');
    expect(event.payload).toEqual({ id: 'ch_1' });
    expect(event.signature).toBe('bad_sig');
    expect(event.verified).toBe(false);
    expect(event.processed).toBe(false);
    expect(event.retryCount).toBe(0);
    expect(event.error).toBe('Sig mismatch');
  });

  it('getQueuedWebhooks filters out already-processed events', () => {
    const active = queueFailedWebhook('stripe', 'ev.a', {}, 'sig1', NOW_ISO, 'err');
    const done = queueFailedWebhook('stripe', 'ev.b', {}, 'sig2', NOW_ISO, 'err');
    markWebhookProcessed(done.id);

    const queue = getQueuedWebhooks(100);
    const ids = queue.map(e => e.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(done.id);
  });

  it('getQueuedWebhooks respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      queueFailedWebhook('stripe', `ev.${i}`, { i }, 'sig', NOW_ISO, 'err');
    }

    const limited = getQueuedWebhooks(4);
    expect(limited.length).toBe(4);
  });

  it('retryWebhook increments retryCount on each call', () => {
    createWebhookSecret('paypal', SECRET);
    const event = queueFailedWebhook('paypal', 'sale.completed', {}, 'bad_sig', NOW_ISO, 'err');

    retryWebhook(event.id);
    let stored = getAllWebhookSecrets(); // just to keep linter happy
    const afterOne = getQueuedWebhooks(100).find(e => e.id === event.id);
    // After first retry with bad sig, event is still queued with retryCount=1
    const all1 = getWebhookEvents(100).find(e => e.id === event.id);
    expect(all1?.retryCount).toBe(1);
  });

  it('retryWebhook returns null after 3 retries (max attempts reached)', () => {
    createWebhookSecret('paypal', SECRET);
    const event = queueFailedWebhook('paypal', 'sale.done', {}, 'bad_sig', NOW_ISO, 'err');

    // Exhaust all 3 retries
    retryWebhook(event.id);
    retryWebhook(event.id);
    retryWebhook(event.id);

    // 4th call — already at max
    const result = retryWebhook(event.id);
    expect(result).toBeNull();

    // Verify retryCount is capped at 3
    const stored = getWebhookEvents(100).find(e => e.id === event.id);
    expect(stored?.retryCount).toBe(3);
  });

  it('retryWebhook marks event as verified/processed on valid signature', () => {
    const ts = tsOffset(-3_000); // 3 seconds ago — well within tolerance
    createWebhookSecret('stripe', SECRET);
    const payload = { id: 'evt_retry_success', amount: 9900 };
    const payloadStr = JSON.stringify(payload);
    const goodSig = generateWebhookSignature(payloadStr, SECRET, ts);

    const event = queueFailedWebhook('stripe', 'payment.success', payload, goodSig, ts, 'original err');

    const result = retryWebhook(event.id);
    expect(result).not.toBeNull();
    expect(result?.isValid).toBe(true);

    const stored = getWebhookEvents(100).find(e => e.id === event.id);
    expect(stored?.verified).toBe(true);
    expect(stored?.processed).toBe(true);
    expect(stored?.processedAt).toBeDefined();
    expect(stored?.error).toBeUndefined();
  });

  it('markWebhookProcessed sets processed=true and processedAt', () => {
    const event = queueFailedWebhook('stripe', 'inv.paid', {}, 'sig', NOW_ISO, 'err');

    const success = markWebhookProcessed(event.id);
    expect(success).toBe(true);

    const stored = getWebhookEvents(100).find(e => e.id === event.id);
    expect(stored?.processed).toBe(true);
    expect(stored?.processedAt).toBeDefined();

    // Must no longer appear in getQueuedWebhooks
    const queue = getQueuedWebhooks(100);
    expect(queue.find(e => e.id === event.id)).toBeUndefined();
  });

  it('getQueuedWebhooks excludes events that reached max retries', () => {
    createWebhookSecret('stripe', SECRET);
    const event = queueFailedWebhook('stripe', 'ev.maxretry', {}, 'bad', NOW_ISO, 'err');

    retryWebhook(event.id);
    retryWebhook(event.id);
    retryWebhook(event.id);

    // retryCount is now 3 — getQueuedWebhooks filters retryCount < 3
    const queue = getQueuedWebhooks(100);
    expect(queue.find(e => e.id === event.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Constant-Time Comparison (Timing Attack Prevention)
// ---------------------------------------------------------------------------

describe('7. Constant-Time Comparison (Timing Attack Prevention)', () => {
  beforeEach(() => {
    clearWebhookSecrets();
    clearWebhookEvents();
  });

  /**
   * We cannot directly unit-test the private `constantTimeEquals` function,
   * but we can verify its observable behavior via `verifyWebhookSignature`:
   *
   * - A signature of a different length must be rejected.
   * - A signature of the same length but wrong bytes must also be rejected.
   *
   * The internal implementation uses a XOR-accumulation loop that always
   * iterates all bytes, providing constant-time guarantees.
   */

  it('wrong-length signature is rejected (length check does not leak via timing)', () => {
    createWebhookSecret('stripe', SECRET);
    const ts = tsOffset(-1_000);

    // 63 chars — one byte short of 64
    const shortSig = 'a'.repeat(63);
    const result = verifyWebhookSignature({
      signature: shortSig,
      timestamp: ts,
      body: PAYLOAD,
      provider: 'stripe',
    });
    expect(result.isValid).toBe(false);
  });

  it('correct-length but wrong-content signature is rejected (full byte comparison)', () => {
    createWebhookSecret('stripe', SECRET);
    const ts = tsOffset(-1_000);

    // All-zero hex, correct length (64 chars)
    const wrongSig = '0'.repeat(64);
    const result = verifyWebhookSignature({
      signature: wrongSig,
      timestamp: ts,
      body: PAYLOAD,
      provider: 'stripe',
    });
    expect(result.isValid).toBe(false);
  });

  it('one-bit flip in signature causes rejection', () => {
    createWebhookSecret('stripe', SECRET);
    const ts = tsOffset(-1_000);

    const correctSig = generateWebhookSignature(PAYLOAD, SECRET, ts);
    // Flip the last hex character
    const flippedSig = correctSig.slice(0, -1) + (correctSig.endsWith('0') ? '1' : '0');

    const result = verifyWebhookSignature({
      signature: flippedSig,
      timestamp: ts,
      body: PAYLOAD,
      provider: 'stripe',
    });
    expect(result.isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Multiple Provider Isolation
// ---------------------------------------------------------------------------

describe('8. Multiple Provider Isolation', () => {
  const providers: WebhookProvider[] = ['stripe', 'paypal', 'github', 'custom'];

  beforeEach(() => {
    clearWebhookSecrets();
    clearWebhookEvents();
  });

  it('all four providers work independently with their own secrets', () => {
    const ts = tsOffset(-3_000);

    providers.forEach(provider => {
      const providerSecret = `whsec_iso_${provider}_secret_at_least_32_chars_xxxxx`;
      createWebhookSecret(provider, providerSecret);
      const sig = generateWebhookSignature(PAYLOAD, providerSecret, ts);

      const result = verifyWebhookSignature({
        signature: sig,
        timestamp: ts,
        body: PAYLOAD,
        provider,
      });
      expect(result.isValid).toBe(true);
    });
  });

  it('secrets from one provider do not affect another', () => {
    const ts = tsOffset(-3_000);

    // Create secrets for stripe and paypal with different values
    const stripeSecret = 'whsec_stripe_isolation_test_minimum_32_chars_xxx';
    const paypalSecret = 'whsec_paypal_isolation_test_minimum_32_chars_xxx';
    createWebhookSecret('stripe', stripeSecret);
    createWebhookSecret('paypal', paypalSecret);

    // Sign with stripe secret but claim it's paypal — must fail
    const stripeSig = generateWebhookSignature(PAYLOAD, stripeSecret, ts);
    const result = verifyWebhookSignature({
      signature: stripeSig,
      timestamp: ts,
      body: PAYLOAD,
      provider: 'paypal',
    });
    expect(result.isValid).toBe(false);
  });

  it('deactivating all secrets for one provider does not affect others', () => {
    const ts = tsOffset(-3_000);
    const sharedSecret = 'whsec_shared_value_deactivation_test_32_chars_xx';

    providers.forEach(p => createWebhookSecret(p, sharedSecret));

    // Deactivate all stripe secrets
    getAllWebhookSecrets()
      .filter(s => s.provider === 'stripe')
      .forEach(s => deactivateWebhookSecret(s.id));

    // Stripe should fail
    const stripeSig = generateWebhookSignature(PAYLOAD, sharedSecret, ts);
    const stripeResult = verifyWebhookSignature({
      signature: stripeSig,
      timestamp: ts,
      body: PAYLOAD,
      provider: 'stripe',
    });
    expect(stripeResult.isValid).toBe(false);

    // Other providers should still work
    (['paypal', 'github', 'custom'] as WebhookProvider[]).forEach(provider => {
      const sig = generateWebhookSignature(PAYLOAD, sharedSecret, ts);
      const res = verifyWebhookSignature({ signature: sig, timestamp: ts, body: PAYLOAD, provider });
      expect(res.isValid).toBe(true);
    });
  });

  it('getActiveSecretForProvider returns null when provider has no active secret', () => {
    // github has no secret at all
    const active = getActiveSecretForProvider('github');
    expect(active).toBeNull();
  });

  it('queued events for different providers are independent', () => {
    queueFailedWebhook('stripe', 'charge.failed', {}, 'sig1', NOW_ISO, 'err');
    queueFailedWebhook('paypal', 'sale.failed', {}, 'sig2', NOW_ISO, 'err');

    const all = getQueuedWebhooks(100);
    const stripeEvents = all.filter(e => e.provider === 'stripe');
    const paypalEvents = all.filter(e => e.provider === 'paypal');

    expect(stripeEvents.length).toBe(1);
    expect(paypalEvents.length).toBe(1);
  });
});
