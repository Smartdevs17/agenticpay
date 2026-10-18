import { describe, it, expect, beforeEach } from 'vitest';
import type { Request } from 'express';
import { verifyBankPartnerWebhook, verifyCustomProviderWebhook } from '../providers.js';
import { createWebhookSecret, clearWebhookSecrets } from '../verification.js';
import {
  BANK_PARTNER_FIXTURE_SECRET,
  bankPartnerWebhookFixture,
  customWebhookFixture,
  unsignedWebhookFixture,
} from '../../../tests/fixtures/webhooks.js';

function makeReq(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

describe('provider webhook verification fixtures (#1006)', () => {
  beforeEach(() => {
    clearWebhookSecrets();
    createWebhookSecret('custom', BANK_PARTNER_FIXTURE_SECRET);
  });

  describe('bank partner', () => {
    it('accepts a correctly signed bank-partner payload', () => {
      const fixture = bankPartnerWebhookFixture();
      const result = verifyBankPartnerWebhook(makeReq(fixture.headers), fixture.body);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.payload).toEqual(JSON.parse(fixture.body));
    });

    it('rejects a tampered payload', () => {
      const fixture = bankPartnerWebhookFixture();
      const result = verifyBankPartnerWebhook(makeReq(fixture.headers), `${fixture.body} `);

      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/signature verification failed/i);
    });

    it('rejects an unsigned payload', () => {
      const fixture = unsignedWebhookFixture();
      const result = verifyBankPartnerWebhook(makeReq(fixture.headers), fixture.body);

      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/missing/i);
    });

    it('rejects a signature outside the replay window', () => {
      const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const fixture = bankPartnerWebhookFixture({ timestamp: staleTimestamp });
      const result = verifyBankPartnerWebhook(makeReq(fixture.headers), fixture.body);

      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/tolerance/i);
    });

    it('accepts the sha256= prefixed signature form', () => {
      const fixture = bankPartnerWebhookFixture();
      const headers = { ...fixture.headers, 'x-bank-signature': `sha256=${fixture.signature}` };
      const result = verifyBankPartnerWebhook(makeReq(headers), fixture.body);

      expect(result.isValid).toBe(true);
    });
  });

  describe('generic custom provider', () => {
    it('accepts a fixture signed with the default custom secret', () => {
      clearWebhookSecrets();
      const fixture = customWebhookFixture();
      createWebhookSecret('custom', fixture.secret);

      const result = verifyCustomProviderWebhook(makeReq(fixture.headers), fixture.body);
      expect(result.isValid).toBe(true);
    });
  });
});
