import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WebhookKeyRegistry,
  WebhookKeyError,
  generateWebhookKeySecret,
  buildWebhookDigest,
  constantTimeEqualHex,
  parseWebhookSignature,
  normalizeWebhookTimestamp,
  getWebhookKeyRegistry,
  initWebhookKeyRegistry,
  resetWebhookKeyRegistry,
  DEFAULT_TOLERANCE_SECONDS,
  DEFAULT_OVERLAP_SECONDS,
  MIN_WEBHOOK_KEY_SECRET_LENGTH,
} from '../webhookKeys';

const PAYLOAD = JSON.stringify({ event: 'payment.created', data: { amount: 100, currency: 'USD' } });

function makeRegistry(overrides: { overlapSeconds?: number; toleranceSeconds?: number; retentionSeconds?: number } = {}) {
  let clock = 1_700_000_000_000;
  const registry = new WebhookKeyRegistry({
    now: () => clock,
    overlapSeconds: overrides.overlapSeconds ?? DEFAULT_OVERLAP_SECONDS,
    toleranceSeconds: overrides.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS,
    retentionSeconds: overrides.retentionSeconds,
  });
  return {
    registry,
    advance(ms: number) {
      clock += ms;
      return clock;
    },
    clock() {
      return clock;
    },
  };
}

describe('webhookKeys service', () => {
  describe('generateWebhookKeySecret', () => {
    it('generates unique secrets of sufficient length', () => {
      const a = generateWebhookKeySecret();
      const b = generateWebhookKeySecret();
      expect(a).not.toBe(b);
      expect(a.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe('digest helpers', () => {
    it('builds deterministic HMAC digests from timestamp + body', () => {
      const secret = 'x'.repeat(32);
      const a = buildWebhookDigest(PAYLOAD, secret, 1700000000);
      const b = buildWebhookDigest(PAYLOAD, secret, 1700000000);
      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
      expect(buildWebhookDigest('other', secret, 1700000000)).not.toBe(a);
    });

    it('builds digests from Buffer bodies identically to strings', () => {
      const secret = 'y'.repeat(32);
      expect(buildWebhookDigest(Buffer.from(PAYLOAD), secret, 5)).toBe(buildWebhookDigest(PAYLOAD, secret, 5));
    });

    it('compares hex constant-time only for equal-length same digests', () => {
      const d = 'ab'.repeat(32);
      expect(constantTimeEqualHex(d, d)).toBe(true);
      expect(constantTimeEqualHex(d, 'ab'.repeat(31) + 'cd')).toBe(false);
      expect(constantTimeEqualHex(d, 'zz')).toBe(false);
    });
  });

  describe('parseWebhookSignature', () => {
    it('parses bare hex digests', () => {
      const digest = 'ab'.repeat(32);
      expect(parseWebhookSignature(digest)).toEqual({ digest });
    });

    it('parses versioned and prefixed forms', () => {
      const digest = 'cd'.repeat(32);
      expect(parseWebhookSignature(`v1=${digest}`)).toEqual({ digest });
      expect(parseWebhookSignature(`sha256=${digest}`)).toEqual({ digest });
      expect(parseWebhookSignature(`sig-sha256=${digest}`)).toEqual({ digest });
      expect(parseWebhookSignature(`sha256-${digest}`)).toEqual({ digest });
    });

    it('rejects malformed signatures', () => {
      expect(parseWebhookSignature('')).toBeNull();
      expect(parseWebhookSignature('v1=nothex')).toBeNull();
      expect(parseWebhookSignature('e'.repeat(63))).toBeNull();
      expect(parseWebhookSignature('v1=data.validhexnot64')).toBeNull();
    });

    it('trims whitespace and normalizes hex case', () => {
      expect(parseWebhookSignature(`  v1=${'AB'.repeat(32)}  `)).toEqual({ digest: 'ab'.repeat(32) });
    });

    it('extracts embedded keyId from dotted signatures', () => {
      const digest = 'ef'.repeat(32);
      expect(parseWebhookSignature(`v1=wvk_abc.${digest}`)).toEqual({ keyId: 'wvk_abc', digest });
    });

    it('treats 64-hex bare tokens without prefix as digests not keyIds', () => {
      const digest = '12'.repeat(32);
      expect(parseWebhookSignature(digest)).toEqual({ digest });
      expect(parseWebhookSignature(digest).keyId).toBeUndefined();
    });
  });

  describe('normalizeWebhookTimestamp', () => {
    it('handles seconds, milliseconds, ISO strings, and strings', () => {
      expect(normalizeWebhookTimestamp(1700000000)).toBe(1_700_000_000_000);
      expect(normalizeWebhookTimestamp('1700000000')).toBe(1_700_000_000_000);
      expect(normalizeWebhookTimestamp(1700000000000)).toBe(1_700_000_000_000);
      expect(normalizeWebhookTimestamp('2023-11-14T22:13:20.000Z')).toBe(1_700_000_000_000);
    });

    it('rejects unparseable timestamps', () => {
      expect(normalizeWebhookTimestamp('')).toBeNull();
      expect(normalizeWebhookTimestamp('nope')).toBeNull();
      expect(normalizeWebhookTimestamp('   ')).toBeNull();
      expect(normalizeWebhookTimestamp(Number.NaN)).toBeNull();
    });
  });

  describe('register', () => {
    it('registers keys with generated id + secret', () => {
      const { registry } = makeRegistry();
      const key = registry.register({ provider: 'custom' });
      expect(key.keyId).toMatch(/^wvk_custom_/);
      expect(key.secret).toHaveLength(43);
      expect(key.status).toBe('active');
      expect(key.algorithm).toBe('sha256');
      expect(registry.size).toBe(1);
    });

    it('honors provided secret, keyId, label, and expiry', () => {
      const { registry } = makeRegistry();
      const secret = 'k'.repeat(40);
      const key = registry.register({ provider: 'custom', secret, keyId: 'wvk_known', label: 'staging', expiresAt: 12345 });
      expect(key.keyId).toBe('wvk_known');
      expect(key.secret).toBe(secret);
      expect(key.label).toBe('staging');
      expect(key.expiresAt).toBe(12345);
    });

    it('rejects short secrets', () => {
      const { registry } = makeRegistry();
      expect(() => registry.register({ secret: 'short' })).toThrow(WebhookKeyError);
      expect(() => registry.register({ secret: 'short' })).toThrow(/at least/);
      expect(() => registry.register({ secret: 'a'.repeat(MIN_WEBHOOK_KEY_SECRET_LENGTH - 1) })).toThrow();
    });

    it('rejects duplicate keyIds', () => {
      const { registry } = makeRegistry();
      registry.register({ keyId: 'wvk_dup', secret: 's'.repeat(32) });
      expect(() => registry.register({ keyId: 'wvk_dup', secret: 's'.repeat(32) })).toThrow(WebhookKeyError);
      expect(() => registry.register({ keyId: 'wvk_dup' })).toThrow(/already exists/);
    });
  });

  describe('sign/verify roundtrip', () => {
    it('signs and verifies with the active key for a provider', () => {
      const { registry, clock } = makeRegistry();
      registry.register({ provider: 'custom', secret: 'secret_custom_00112233445566778899' });
      const signed = registry.sign({ provider: 'custom', body: PAYLOAD });
      expect(signed.version).toBe('v1');
      expect(signed.timestamp).toBe(String(Math.floor(clock() / 1000)));
      expect(signed.signature).toMatch(/^v1=[a-f0-9]{64}$/);

      const result = registry.verify({ signature: signed.signature, timestamp: signed.timestamp, body: PAYLOAD, provider: 'custom' });
      expect(result.isValid).toBe(true);
      expect(result.keyId).toBe(signed.keyId);
      expect(registry.metrics().verified).toBe(1);
    });

    it('verifies bare-hex and legacy sha256= forms', () => {
      const { registry } = makeRegistry();
      const secret = 'z'.repeat(40);
      registry.register({ provider: 'custom', secret });
      const timestamp = 1700000000;
      const digest = buildWebhookDigest(PAYLOAD, secret, timestamp);
      for (const signature of [digest, `sha256=${digest}`, `v1=${digest}`]) {
        expect(registry.verify({ signature, timestamp, body: PAYLOAD, provider: 'custom' }).isValid).toBe(true);
      }
    });

    it('verifies against a specific keyId hint', () => {
      const { registry } = makeRegistry();
      registry.register({ provider: 'custom', secret: 'a'.repeat(32), keyId: 'wvk_hint' });
      const signed = registry.sign({ keyId: 'wvk_hint', body: PAYLOAD });
      const result = registry.verify({ signature: signed.signature, timestamp: signed.timestamp, body: PAYLOAD, keyId: 'wvk_hint' });
      expect(result.isValid).toBe(true);
    });

    it('rejects tampered bodies and wrong signatures', () => {
      const { registry, clock } = makeRegistry();
      registry.register({ provider: 'custom', secret: 'b'.repeat(32) });
      const signed = registry.sign({ provider: 'custom', body: PAYLOAD });
      expect(registry.verify({ signature: signed.signature, timestamp: signed.timestamp, body: PAYLOAD + 'x', provider: 'custom' }).isValid).toBe(false);
      const forged = registry.verify({ signature: 'v1=' + '0'.repeat(64), timestamp: signed.timestamp, body: PAYLOAD, provider: 'custom' });
      expect(forged.isValid).toBe(false);
      expect(forged.reason).toBe('signature_mismatch');
      expect(registry.metrics().rejected).toBe(2);
      expect(clock()).toBe(registry.nowMs);
    });

    it('accepts Buffer bodies', () => {
      const { registry } = makeRegistry();
      registry.register({ provider: 'custom', secret: 'c'.repeat(32) });
      const signed = registry.sign({ provider: 'custom', body: Buffer.from(PAYLOAD) });
      const result = registry.verify({ signature: signed.signature, timestamp: signed.timestamp, body: Buffer.from(PAYLOAD), provider: 'custom' });
      expect(result.isValid).toBe(true);
    });

    it('rejects without signature, timestamp, or on invalid format', () => {
      const { registry, clock } = makeRegistry();
      registry.register({ provider: 'custom', secret: 'd'.repeat(32) });
      expect(registry.verify({ signature: '', timestamp: '1700000000', body: PAYLOAD }).reason).toBe('missing_signature');
      expect(registry.verify({ signature: 'v1=zzzz', timestamp: '1700000000', body: PAYLOAD }).reason).toBe('invalid_signature_format');
      expect(registry.verify({ signature: 'v1=' + 'a'.repeat(64), timestamp: '', body: PAYLOAD }).reason).toBe('missing_timestamp');
      expect(registry.verify({ signature: 'v1=' + 'a'.repeat(64), timestamp: 'nope', body: PAYLOAD }).reason).toBe('missing_timestamp');
      const reasons = registry.metrics().rejectionsByReason;
      expect(reasons.missing_signature).toBe(1);
      expect(reasons.invalid_signature_format).toBe(1);
      expect(reasons.missing_timestamp).toBe(2);
      expect(clock()).toBe(registry.nowMs);
    });

    it('rejects timestamps outside tolerance', () => {
      const { registry, advance } = makeRegistry({ toleranceSeconds: 300 });
      registry.register({ provider: 'custom', secret: 'e'.repeat(32) });
      const signed = registry.sign({ provider: 'custom', body: PAYLOAD });

      const hop = (ms: number) => {
        advance(ms);
        return registry.verify({ signature: signed.signature, timestamp: signed.timestamp, body: PAYLOAD, provider: 'custom' });
      };
      const ok = hop(299_000);
      expect(ok.isValid).toBe(true);
      const stale = hop(2_000);
      const result = registry.verify({ signature: signed.signature, timestamp: signed.timestamp, body: PAYLOAD, provider: 'custom' });
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('timestamp_out_of_tolerance');
      expect(stale.isValid).toBe(false);
    });

    it('rejects when the provider has no keys', () => {
      const { registry } = makeRegistry();
      const result = registry.verify({ signature: 'v1=' + 'f'.repeat(64), timestamp: '1700000000', body: PAYLOAD, provider: 'github' });
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('no_keys');
      expect(result.error).toMatch(/github/);
    });

    it('scopes keys per provider', () => {
      const { registry } = makeRegistry();
      registry.register({ provider: 'custom', secret: 'g'.repeat(32) });
      const signed = registry.sign({ provider: 'custom', body: PAYLOAD });
      const wrong = registry.verify({ signature: signed.signature, timestamp: signed.timestamp, body: PAYLOAD, provider: 'github' });
      expect(wrong.isValid).toBe(false);
      expect(wrong.reason).toBe('no_keys');
    });
  });

  describe('key rotation', () => {
    it('rotates: retires old key, creates a new active key, keeps old verifiable during overlap', () => {
      const { registry } = makeRegistry({ overlapSeconds: 3600 });
      const first = registry.register({ provider: 'custom', secret: 'first_first_first_first_first_01' });
      const signedOld = registry.sign({ keyId: first.keyId, body: PAYLOAD });

      const { retired, active } = registry.rotate({ provider: 'custom', secret: 'second_second_second_second_second' });
      expect(retired?.keyId).toBe(first.keyId);
      expect(retired?.status).toBe('retiring');
      expect(active.keyId).not.toBe(first.keyId);
      expect(active.status).toBe('active');

      const actives = registry.activeKeysFor('custom');
      expect(actives).toHaveLength(1);
      expect(actives[0].keyId).toBe(active.keyId);

      const signedNew = registry.sign({ provider: 'custom', body: PAYLOAD });
      expect(signedNew.keyId).toBe(active.keyId);

      expect(registry.verify({ signature: signedOld.signature, timestamp: signedOld.timestamp, body: PAYLOAD, provider: 'custom' }).isValid).toBe(true);
      expect(registry.verify({ signature: signedNew.signature, timestamp: signedNew.timestamp, body: PAYLOAD, provider: 'custom' }).isValid).toBe(true);
    });

    it('rejects the retired key once the overlap window elapses', () => {
      const { registry, advance } = makeRegistry({ overlapSeconds: 3600, toleranceSeconds: 7200 });
      registry.register({ provider: 'custom', secret: 'h'.repeat(32) });
      const signedOld = registry.sign({ provider: 'custom', body: PAYLOAD });
      registry.rotate({ provider: 'custom', secret: 'i'.repeat(32) });

      advance(3600 * 1000 + 1000);
      const result = registry.verify({ signature: signedOld.signature, timestamp: signedOld.timestamp, body: PAYLOAD, provider: 'custom', keyId: signedOld.keyId });
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('key_expired');
    });

    it('rotating with no prior key just creates the first active key', () => {
      const { registry } = makeRegistry();
      const { retired, active } = registry.rotate({ provider: 'paypal', secret: 'j'.repeat(32) });
      expect(retired).toBeUndefined();
      expect(active.status).toBe('active');
      expect(registry.activeKeysFor('paypal')[0].keyId).toBe(active.keyId);
    });

    it('can rotate at a custom overlap', () => {
      const { registry, advance } = makeRegistry({ overlapSeconds: DEFAULT_OVERLAP_SECONDS });
      registry.register({ provider: 'custom', secret: 'k'.repeat(32) });
      const oldSig = registry.sign({ provider: 'custom', body: PAYLOAD });
      registry.rotate({ provider: 'custom', secret: 'l'.repeat(32), overlapSeconds: 10 });
      const stillValid = registry.verify({ signature: oldSig.signature, timestamp: oldSig.timestamp, body: PAYLOAD, provider: 'custom', keyId: oldSig.keyId });
      expect(stillValid.isValid).toBe(true);
      advance(11_000);
      const expired = registry.verify({ signature: oldSig.signature, timestamp: oldSig.timestamp, body: PAYLOAD, provider: 'custom', keyId: oldSig.keyId });
      expect(expired.isValid).toBe(false);
    });

    it('sign rejects non-active and unknown keys', () => {
      const { registry } = makeRegistry();
      const key = registry.register({ provider: 'custom', secret: 'm'.repeat(32) });
      registry.rotate({ provider: 'custom', secret: 'n'.repeat(32) });
      expect(() => registry.sign({ keyId: key.keyId, body: PAYLOAD })).toThrow(/not active/);
      expect(() => registry.sign({ keyId: 'wvk_gone', body: PAYLOAD })).toThrow(/does not exist/);
      expect(() => registry.sign({ provider: 'github', body: PAYLOAD })).toThrow(/No active key/);
      expect(registry.metrics().signErrors).toBe(3);
    });
  });

  describe('revoke', () => {
    it('revokes a key and causes its signatures to fail', () => {
      const { registry } = makeRegistry();
      const key = registry.register({ provider: 'custom', secret: 'o'.repeat(32) });
      const signed = registry.sign({ keyId: key.keyId, body: PAYLOAD });
      registry.rotate({ provider: 'custom', secret: 'o2'.repeat(16) });
      expect(registry.revoke(key.keyId)).toBe(true);

      const result = registry.verify({ signature: signed.signature, timestamp: signed.timestamp, body: PAYLOAD, provider: 'custom', keyId: key.keyId });
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('key_revoked');
      expect(registry.getKey(key.keyId)?.status).toBe('revoked');
      expect(registry.metrics().revoked).toBe(1);
    });

    it('refuses to revoke the only active key', () => {
      const { registry } = makeRegistry();
      const key = registry.register({ provider: 'custom', secret: 'p'.repeat(32) });
      expect(() => registry.revoke(key.keyId)).toThrow(WebhookKeyError);
      expect(() => registry.revoke(key.keyId)).toThrow(/rotate first/);
    });

    it('returns false for unknown keys', () => {
      const { registry } = makeRegistry();
      expect(registry.revoke('wvk_missing')).toBe(false);
    });

    it('does not verify with a revoked key when verified without hint', () => {
      const { registry } = makeRegistry();
      const association = registry.register({ provider: 'custom', secret: 'q'.repeat(32) });
      const signedAssociation = registry.sign({ keyId: association.keyId, body: PAYLOAD });
      registry.rotate({ provider: 'custom', secret: 'r'.repeat(32) });
      expect(registry.revoke(association.keyId)).toBe(true);
      const result = registry.verify({ signature: signedAssociation.signature, timestamp: signedAssociation.timestamp, body: PAYLOAD, provider: 'custom' });
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('key_revoked');
    });
  });

  describe('expiry and retention', () => {
    it('rejects active keys that have expired', () => {
      const { registry, advance } = makeRegistry();
      const key = registry.register({ provider: 'custom', secret: 's'.repeat(32), expiresAt: 1_700_000_000_900 });
      const signed = registry.sign({ keyId: key.keyId, body: PAYLOAD });
      advance(2000);
      const result = registry.verify({ signature: signed.signature, timestamp: signed.timestamp, body: PAYLOAD, provider: 'custom', keyId: key.keyId });
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('key_expired');
    });

    it('purges old retired keys after the retention window', () => {
      const { registry, advance } = makeRegistry({ retentionSeconds: 3600 });
      registry.register({ provider: 'custom', secret: 't'.repeat(32) });
      registry.rotate({ provider: 'custom', secret: 'u'.repeat(32) });
      const count = registry.size;
      expect(count).toBe(2);

      expect(registry.purgeExpired()).toBe(0);
      advance(3600 * 1000 + 1);
      expect(registry.purgeExpired()).toBe(1);
      expect(registry.size).toBe(1);
      expect(registry.metrics().purged).toBe(1);
      expect(registry.activeKeysFor('custom')).toHaveLength(1);
    });

    it('listKeys respects status and includeRevoked filters', () => {
      const { registry } = makeRegistry();
      const a = registry.register({ provider: 'custom', secret: 'v'.repeat(32) });
      registry.rotate({ provider: 'custom', secret: 'w'.repeat(32) });
      expect(registry.listKeys({ provider: 'custom' }).length).toBe(2);
      expect(registry.listKeys({ status: 'active' }).length).toBe(1);
      expect(registry.listKeys({ includeRevoked: true }).length).toBe(2);
      registry.revoke(a.keyId);
      expect(registry.listKeys({ includeRevoked: true }).length).toBe(2);
      expect(registry.listKeys().length).toBe(1);
    });
  });

  describe('metrics', () => {
    it('tracks lifecycle and verification metrics', () => {
      const { registry } = makeRegistry();
      registry.register({ provider: 'custom', secret: 'x'.repeat(32) });
      registry.rotate({ provider: 'custom', secret: 'x'.repeat(32) });
      expect(registry.metrics().registered).toBe(2);
      expect(registry.metrics().rotated).toBe(1);

      registry.resetMetrics();
      expect(registry.metrics().registered).toBe(0);
      expect(registry.metrics().rotated).toBe(0);
      expect(registry.metrics().verifications).toBe(0);
    });

    it('getActiveKey returns newest active; hasKeysForProvider reflects retiring keys', () => {
      const { registry } = makeRegistry();
      registry.register({ provider: 'custom', secret: 'y'.repeat(32) });
      const { active } = registry.rotate({ provider: 'custom', secret: 'y'.repeat(32) });
      expect(registry.getActiveKey('custom')?.keyId).toBe(active.keyId);
      expect(registry.getActiveKey()?.provider).toBe('custom');
      expect(registry.hasKeysForProvider('custom')).toBe(true);
      expect(registry.hasKeysForProvider('github')).toBe(false);
    });
  });

  describe('singleton', () => {
    beforeEach(() => resetWebhookKeyRegistry());
    afterEach(() => resetWebhookKeyRegistry());

    it('returns a stable shared instance', () => {
      const a = getWebhookKeyRegistry();
      const b = getWebhookKeyRegistry();
      expect(a).toBe(b);
    });

    it('init replaces the instance and seeds configured keys', () => {
      const registry = initWebhookKeyRegistry({
        keys: [{ provider: 'custom', secret: 'zz'.repeat(16) }],
        toleranceSeconds: 60,
      });
      expect(getWebhookKeyRegistry()).toBe(registry);
      expect(registry.size).toBe(1);
      expect(registry.toleranceSeconds).toBe(60);
    });
  });
});