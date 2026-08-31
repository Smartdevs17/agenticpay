import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request } from 'express';
import {
  verifyCustomProviderWebhookWithKeys,
  configureWebhookVerification,
  resetWebhookVerificationConfig,
} from '../webhookVerification.js';
import {
  initWebhookKeyRegistry,
  resetWebhookKeyRegistry,
} from '../../services/webhookKeys.js';
import { generateWebhookSignature } from '../../services/webhooks/verification.js';

vi.mock('../../services/stripe.js', () => ({
  constructWebhookEvent: () => {
    throw new Error('stripe not exercised in this suite');
  },
}));

const PAYLOAD = JSON.stringify({ event: 'payment.captured', data: { id: 'evt_123' } });
const LEGACY_CUSTOM_SECRET = 'whsec_test_default_custom_secret_key_32_chars_min';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

describe('webhookVerification middleware (key rotation)', () => {
  beforeEach(() => {
    initWebhookKeyRegistry();
    resetWebhookVerificationConfig();
  });
  afterEach(() => {
    resetWebhookKeyRegistry();
    resetWebhookVerificationConfig();
  });

  describe('verifyCustomProviderWebhookWithKeys', () => {
    it('verifies AgenticPay-signature/timestamp signed with a registered key', () => {
      const registry = initWebhookKeyRegistry({
        keys: [{ provider: 'custom', secret: 'rotation_secret_99_abcdefghijklmnop' }],
      });
      const signed = registry.sign({ provider: 'custom', body: PAYLOAD });
      const req = makeReq({
        headers: {
          'x-agenticpay-signature': signed.signature,
          'x-agenticpay-timestamp': signed.timestamp,
          'x-webhook-id': 'evt_rot_1',
        },
      });

      const result = verifyCustomProviderWebhookWithKeys(req, PAYLOAD);
      expect(result.isValid).toBe(true);
      expect(result.provider).toBe('custom');
      expect(result.eventId).toBe('evt_rot_1');
      expect(result.payload).toEqual(JSON.parse(PAYLOAD));
      expect(result.keyId).toBeUndefined();
      expect(registry.metrics().verified).toBe(1);
    });

    it('verifies legacy sha256= custom signatures against the registry', () => {
      const registry = initWebhookKeyRegistry({
        keys: [{ provider: 'custom', secret: 'a'.repeat(32) }],
      });
      const signed = registry.sign({ provider: 'custom', body: PAYLOAD });
      const legacyHeader = `sha256=${signed.signature.replace(/^v1=/, '')}`;
      const req = makeReq({
        headers: {
          'x-signature': legacyHeader,
          'x-timestamp': signed.timestamp,
        },
      });
      const result = verifyCustomProviderWebhookWithKeys(req, PAYLOAD);
      expect(result.isValid).toBe(true);
    });

    it('rejects tampered payloads with an error message', () => {
      const registry = initWebhookKeyRegistry({
        keys: [{ provider: 'custom', secret: 'b'.repeat(32) }],
      });
      const signed = registry.sign({ provider: 'custom', body: PAYLOAD });
      const req = makeReq({
        headers: {
          'x-agenticpay-signature': signed.signature,
          'x-agenticpay-timestamp': signed.timestamp,
        },
      });
      const result = verifyCustomProviderWebhookWithKeys(req, PAYLOAD + 'tampered');
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/verification failed/i);
      expect(registry.metrics().rejected).toBe(1);
    });

    it('rejects stale timestamps outside the tolerance window', () => {
      let clock = 1_700_000_000_000;
      const registry = initWebhookKeyRegistry({
        now: () => clock,
        keys: [{ provider: 'custom', secret: 'c'.repeat(32) }],
      });
      const signed = registry.sign({ provider: 'custom', body: PAYLOAD });
      clock += 350_000;
      const req = makeReq({
        headers: {
          'x-agenticpay-signature': signed.signature,
          'x-agenticpay-timestamp': signed.timestamp,
        },
      });
      const result = verifyCustomProviderWebhookWithKeys(req, PAYLOAD);
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/tolerance/i);
      expect(registry.metrics().rejected).toBe(1);
    });

    it('honors toleranceSeconds from middleware configuration', () => {
      let clock = 1_700_000_000_000;
      const registry = initWebhookKeyRegistry({
        now: () => clock,
        keys: [{ provider: 'custom', secret: 'c'.repeat(32) }],
      });
      configureWebhookVerification({ toleranceSeconds: 1200 });
      const signed = registry.sign({ provider: 'custom', body: PAYLOAD });
      clock += 900_000;
      const req = makeReq({
        headers: {
          'x-agenticpay-signature': signed.signature,
          'x-agenticpay-timestamp': signed.timestamp,
        },
      });
      const result = verifyCustomProviderWebhookWithKeys(req, PAYLOAD);
      expect(result.isValid).toBe(true);
      const metrics = registry.metrics();
      expect(metrics.verified).toBe(1);
      resetWebhookVerificationConfig();
    });

    it('falls back to legacy verification when the registry has no custom keys', () => {
      initWebhookKeyRegistry();
      const timestamp = new Date().toISOString();
      const signature = generateWebhookSignature(PAYLOAD, LEGACY_CUSTOM_SECRET, timestamp);
      const req = makeReq({
        headers: {
          'x-signature': signature,
          'x-timestamp': timestamp,
        },
      });
      const result = verifyCustomProviderWebhookWithKeys(req, PAYLOAD);
      expect(result.isValid).toBe(true);
    });

    it('forces legacy verification when key rotation is disabled', () => {
      initWebhookKeyRegistry({
        keys: [{ provider: 'custom', secret: 'd'.repeat(32) }],
      });
      configureWebhookVerification({ useKeyRotation: false });
      const timestamp = new Date().toISOString();
      const signature = generateWebhookSignature(PAYLOAD, LEGACY_CUSTOM_SECRET, timestamp);
      const req = makeReq({
        headers: {
          'x-signature': signature,
          'x-timestamp': timestamp,
        },
      });
      const result = verifyCustomProviderWebhookWithKeys(req, PAYLOAD);
      expect(result.isValid).toBe(true);
    });

    it('accepts array-shaped signature and timestamp headers', () => {
      const registry = initWebhookKeyRegistry({
        keys: [{ provider: 'custom', secret: 'e2'.repeat(16) }],
      });
      const signed = registry.sign({ provider: 'custom', body: PAYLOAD });
      const req = makeReq({
        headers: {
          'x-agenticpay-signature': [signed.signature],
          'x-agenticpay-timestamp': [signed.timestamp],
        },
      });
      const result = verifyCustomProviderWebhookWithKeys(req, PAYLOAD);
      expect(result.isValid).toBe(true);
      expect(registry.metrics().verified).toBe(1);
    });

    it('returns invalid with a clear error when signature headers are absent', () => {
      initWebhookKeyRegistry({
        keys: [{ provider: 'custom', secret: 'e'.repeat(32) }],
      });
      const req = makeReq({ headers: {} });
      const result = verifyCustomProviderWebhookWithKeys(req, PAYLOAD);
      expect(result.isValid).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});