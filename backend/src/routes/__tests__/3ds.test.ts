/**
 * Route-level tests – 3DS Authentication Endpoints
 *
 * These tests exercise the HTTP layer (request validation, response shape)
 * without spinning up a real HTTP server.  We instantiate the router directly
 * and call through to the service, which uses its in-memory store.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initiate3DS,
  verify3DS,
  cancel3DSSession,
  _clearSessions,
} from '../../services/3ds.js';
import {
  initiate3DSSchema,
  verify3DSSchema,
  cancel3DSSchema,
} from '../../schemas/3ds.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_INITIATE = {
  paymentIntentId: 'pi_route_test_001',
  amount: 200,
  currency: 'USD',
  returnUrl: 'https://example.com/callback',
  merchantId: 'merch_route_01',
};

// BIN 400000 → enrolled (even last digit)
const ENROLLED_CARD = { cardBin: '400000' };
// BIN 411111 → not enrolled (odd last digit)
const NOT_ENROLLED_CARD = { cardBin: '411111' };

beforeEach(() => {
  _clearSessions();
});

// ── Schema validation ─────────────────────────────────────────────────────────

describe('Initiate3DS schema', () => {
  it('accepts valid initiation payload with cardBin', () => {
    const result = initiate3DSSchema.safeParse({ ...BASE_INITIATE, ...ENROLLED_CARD });
    expect(result.success).toBe(true);
  });

  it('accepts valid payload with cardToken', () => {
    const result = initiate3DSSchema.safeParse({
      ...BASE_INITIATE,
      cardToken: 'tok_400000_xyz',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid payload with full cardNumber', () => {
    const result = initiate3DSSchema.safeParse({
      ...BASE_INITIATE,
      cardNumber: '4000001111111119',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when no card identifier is supplied', () => {
    const result = initiate3DSSchema.safeParse({ ...BASE_INITIATE });
    expect(result.success).toBe(false);
  });

  it('rejects invalid cardNumber (letters)', () => {
    const result = initiate3DSSchema.safeParse({
      ...BASE_INITIATE,
      cardNumber: 'not-a-card-number',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-URL returnUrl', () => {
    const result = initiate3DSSchema.safeParse({
      ...BASE_INITIATE,
      ...ENROLLED_CARD,
      returnUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-3-char currency code', () => {
    const result = initiate3DSSchema.safeParse({
      ...BASE_INITIATE,
      ...ENROLLED_CARD,
      currency: 'US',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = initiate3DSSchema.safeParse({
      ...BASE_INITIATE,
      ...ENROLLED_CARD,
      amount: -50,
    });
    expect(result.success).toBe(false);
  });
});

describe('Verify3DS schema', () => {
  it('accepts valid verify payload with transStatus', () => {
    const result = verify3DSSchema.safeParse({
      threeDSSessionId: 'sess-001',
      paymentIntentId: 'pi_001',
      transStatus: 'Y',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid verify payload with paRes', () => {
    const result = verify3DSSchema.safeParse({
      threeDSSessionId: 'sess-001',
      paymentIntentId: 'pi_001',
      paRes: 'BASE64_DATA',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid transStatus values', () => {
    const result = verify3DSSchema.safeParse({
      threeDSSessionId: 'sess-001',
      paymentIntentId: 'pi_001',
      transStatus: 'X',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty threeDSSessionId', () => {
    const result = verify3DSSchema.safeParse({
      threeDSSessionId: '',
      paymentIntentId: 'pi_001',
    });
    expect(result.success).toBe(false);
  });
});

describe('Cancel3DS schema', () => {
  it('accepts minimal cancel payload', () => {
    const result = cancel3DSSchema.safeParse({ threeDSSessionId: 'sess-001' });
    expect(result.success).toBe(true);
  });

  it('accepts cancel with optional reason', () => {
    const result = cancel3DSSchema.safeParse({
      threeDSSessionId: 'sess-001',
      reason: 'User abandoned',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty threeDSSessionId', () => {
    const result = cancel3DSSchema.safeParse({ threeDSSessionId: '' });
    expect(result.success).toBe(false);
  });
});

// ── Service integration through route-layer logic ─────────────────────────────

describe('3DS end-to-end flow (service layer)', () => {
  it('happy path: initiate → verify (enrolled card, 3DS2)', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_CARD });

    expect(init.enrolled).toBe(true);
    expect(init.status).toBe('challenge_required');

    const verify = verify3DS({
      threeDSSessionId: init.threeDSSessionId,
      paymentIntentId: BASE_INITIATE.paymentIntentId,
      transStatus: 'Y',
    });

    expect(verify.authenticated).toBe(true);
    expect(verify.status).toBe('authenticated');
    expect(verify.eci).toBeTruthy();
    expect(verify.authenticationValue).toBeTruthy();
  });

  it('handles not-enrolled card: initiate returns not_enrolled', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...NOT_ENROLLED_CARD });

    expect(init.enrolled).toBe(false);
    expect(init.status).toBe('not_enrolled');
  });

  it('cancel flow: initiate → cancel returns success', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_CARD });
    const cancel = cancel3DSSession(init.threeDSSessionId, 'Cardholder closed window');

    expect(cancel.success).toBe(true);
  });

  it('verify returns error for unknown session ID', () => {
    const result = verify3DS({
      threeDSSessionId: 'does-not-exist',
      paymentIntentId: 'pi_xxx',
      transStatus: 'Y',
    });

    expect(result.status).toBe('error');
    expect(result.authenticated).toBe(false);
  });

  it('frictionless sandbox flow completes without challenge', () => {
    const init = initiate3DS(
      { ...BASE_INITIATE, ...ENROLLED_CARD },
      { sandboxFrictionless: true },
    );

    expect(init.status).toBe('authenticated');
    expect(init.enrolled).toBe(true);

    // Verify should report already-authenticated
    const verify = verify3DS({
      threeDSSessionId: init.threeDSSessionId,
      paymentIntentId: BASE_INITIATE.paymentIntentId,
      transStatus: 'Y',
    });

    expect(verify.authenticated).toBe(true);
  });

  it('multiple sessions are independent', () => {
    const init1 = initiate3DS({ ...BASE_INITIATE, paymentIntentId: 'pi_a', ...ENROLLED_CARD });
    const init2 = initiate3DS({ ...BASE_INITIATE, paymentIntentId: 'pi_b', ...ENROLLED_CARD });

    expect(init1.threeDSSessionId).not.toBe(init2.threeDSSessionId);

    const v1 = verify3DS({
      threeDSSessionId: init1.threeDSSessionId,
      paymentIntentId: 'pi_a',
      transStatus: 'Y',
    });
    const v2 = verify3DS({
      threeDSSessionId: init2.threeDSSessionId,
      paymentIntentId: 'pi_b',
      transStatus: 'N',
    });

    expect(v1.authenticated).toBe(true);
    expect(v2.authenticated).toBe(false);
  });
});
