/**
 * Signed provider webhook fixtures (#1006).
 *
 * These fixtures let the verification tests exercise the real code path with
 * captured-looking payloads instead of hand-rolling a signature in every test.
 */

import { generateWebhookSignature } from '../../services/webhooks/verification.js';

export interface SignedWebhookFixture {
  /** Provider the fixture is signed for. */
  provider: 'stripe' | 'paypal' | 'github' | 'custom';
  /** Raw body exactly as the provider would send it. */
  body: string;
  /** Secret the fixture was signed with. */
  secret: string;
  timestamp: string;
  signature: string;
  headers: Record<string, string>;
}

/** Secret used by the bank-partner fixtures. Test-only. */
export const BANK_PARTNER_FIXTURE_SECRET = 'whsec_test_bank_partner_secret_32_chars_min';

export const BANK_PARTNER_PAYLOAD = JSON.stringify({
  event: 'payout.settled',
  data: { paymentId: 'bp_pay_123', status: 'completed', amount: 1500 },
});

/** Sign a body the way a bank partner signs its payout webhooks. */
export function signBankPartner(body: string, timestamp: string, secret = BANK_PARTNER_FIXTURE_SECRET): string {
  return generateWebhookSignature(body, secret, timestamp);
}

/** A valid, freshly-signed bank-partner webhook. */
export function bankPartnerWebhookFixture(overrides: Partial<SignedWebhookFixture> = {}): SignedWebhookFixture {
  const body = overrides.body ?? BANK_PARTNER_PAYLOAD;
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const secret = overrides.secret ?? BANK_PARTNER_FIXTURE_SECRET;
  const signature = overrides.signature ?? signBankPartner(body, timestamp, secret);
  return {
    provider: 'custom',
    body,
    secret,
    timestamp,
    signature,
    headers: {
      'x-bank-signature': signature,
      'x-bank-timestamp': timestamp,
      ...(overrides.headers ?? {}),
    },
  };
}

/** A generic AgenticPay-signed webhook (`x-signature` / `x-timestamp`). */
export function customWebhookFixture(overrides: Partial<SignedWebhookFixture> = {}): SignedWebhookFixture {
  const body = overrides.body ?? JSON.stringify({ event: 'payment.captured', data: { id: 'evt_1' } });
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const secret = overrides.secret ?? 'whsec_test_default_custom_secret_key_32_chars_min';
  const signature = overrides.signature ?? generateWebhookSignature(body, secret, timestamp);
  return {
    provider: 'custom',
    body,
    secret,
    timestamp,
    signature,
    headers: { 'x-signature': signature, 'x-timestamp': timestamp, ...(overrides.headers ?? {}) },
  };
}

/** Headers-only variant used to prove unsigned payloads are rejected. */
export function unsignedWebhookFixture(headers: Record<string, string> = {}): { body: string; headers: Record<string, string> } {
  return { body: BANK_PARTNER_PAYLOAD, headers };
}
