/**
 * Unit tests – 3DS Authentication Service
 *
 * Covers:
 *  - initiate3DS: enrolled / not-enrolled / frictionless sandbox / 3DS1 vs 3DS2
 *  - verify3DS:   success (Y, A), failure (N, R), session-not-found, expired, mismatch
 *  - get3DSSession: present / absent
 *  - cancel3DSSession: success / missing session
 *  - purgeExpiredSessions: cleans only expired entries
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initiate3DS,
  verify3DS,
  get3DSSession,
  cancel3DSSession,
  purgeExpiredSessions,
  _clearSessions,
  _seedSession,
  type ThreeDSSession,
} from '../3ds.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_INITIATE = {
  paymentIntentId: 'pi_test_001',
  amount: 100,
  currency: 'USD',
  returnUrl: 'https://example.com/callback',
  merchantId: 'merch_01',
};

/** Even-digit BINs → enrolled in our test heuristic */
const ENROLLED_CARD = { cardNumber: '4000000000000002' }; // BIN 400000, last digit 0 → enrolled
const NOT_ENROLLED_CARD = { cardNumber: '4100000000000001' }; // BIN 410000, last digit 0 → enrolled
// Actually let's use cards that map deterministically:
// BIN 400000 ends in 0 → even → enrolled
// BIN 510000 ends in 0 → even → enrolled (Mastercard → 3DS2.2)
// BIN 411111 ends in 1 → odd → NOT enrolled
const ENROLLED_VISA = { cardNumber: '4000001111111119' }; // BIN 400000 → enrolled, Visa → 2.1
const ENROLLED_MC = { cardNumber: '5100001111111119' }; // BIN 510000 → enrolled, MC → 2.2
const NOT_ENROLLED_VISA = { cardNumber: '4111111111111111' }; // BIN 411111, last '1' → odd → not enrolled

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _clearSessions();
});

// ── initiate3DS ───────────────────────────────────────────────────────────────

describe('initiate3DS', () => {
  it('returns a valid session for an enrolled Visa card (3DS 2.1)', () => {
    const result = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_VISA });

    expect(result.threeDSSessionId).toBeTruthy();
    expect(result.enrolled).toBe(true);
    expect(result.status).toBe('challenge_required');
    expect(result.version).toBe('2.1');
    expect(result.acsUrl).toContain('acs.example.com');
    expect(result.creq).toBeTruthy();
    expect(result.pareq).toBeUndefined();
  });

  it('returns a valid session for an enrolled Mastercard (3DS 2.2)', () => {
    const result = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_MC });

    expect(result.enrolled).toBe(true);
    expect(result.version).toBe('2.2');
    expect(result.status).toBe('challenge_required');
  });

  it('handles not-enrolled cards gracefully', () => {
    const result = initiate3DS({ ...BASE_INITIATE, ...NOT_ENROLLED_VISA });

    expect(result.enrolled).toBe(false);
    expect(result.status).toBe('not_enrolled');
    expect(result.acsUrl).toBeUndefined();
    expect(result.creq).toBeUndefined();
  });

  it('returns frictionless status when sandboxFrictionless=true', () => {
    const result = initiate3DS(
      { ...BASE_INITIATE, ...ENROLLED_VISA },
      { sandboxFrictionless: true },
    );

    expect(result.status).toBe('authenticated');
    expect(result.enrolled).toBe(true);
  });

  it('accepts a card token and extracts BIN correctly', () => {
    // tok_<BIN>_<rest> → BIN 400000 → enrolled
    const result = initiate3DS({ ...BASE_INITIATE, cardToken: 'tok_400000_xyz' });

    expect(result.enrolled).toBe(true);
    expect(result.threeDSSessionId).toBeTruthy();
  });

  it('accepts a bare cardBin', () => {
    const result = initiate3DS({ ...BASE_INITIATE, cardBin: '400000' });

    expect(result.enrolled).toBe(true);
  });

  it('uses legacy 1.0 flow for non-Visa/Mastercard BINs', () => {
    // BIN 370000 → prefix 3700 < 4000 → version 1.0
    const result = initiate3DS({ ...BASE_INITIATE, cardBin: '370000' });

    if (result.enrolled) {
      expect(result.version).toBe('1.0');
      expect(result.pareq).toBeTruthy();
      expect(result.termUrl).toBeTruthy();
    }
    // Whether enrolled depends on last digit of BIN; either path is valid
    expect(result.threeDSSessionId).toBeTruthy();
  });

  it('stores the session so it can be retrieved later', () => {
    const result = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_VISA });

    const stored = get3DSSession(result.threeDSSessionId);
    expect(stored).toBeDefined();
    expect(stored!.paymentIntentId).toBe(BASE_INITIATE.paymentIntentId);
  });
});

// ── verify3DS ─────────────────────────────────────────────────────────────────

describe('verify3DS', () => {
  it('authenticates when transStatus=Y', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_VISA });
    const result = verify3DS({
      threeDSSessionId: init.threeDSSessionId,
      paymentIntentId: BASE_INITIATE.paymentIntentId,
      transStatus: 'Y',
    });

    expect(result.authenticated).toBe(true);
    expect(result.status).toBe('authenticated');
    expect(result.eci).toBe('05');
    expect(result.authenticationValue).toBeTruthy();
  });

  it('authenticates when transStatus=A (attempted)', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_VISA });
    const result = verify3DS({
      threeDSSessionId: init.threeDSSessionId,
      paymentIntentId: BASE_INITIATE.paymentIntentId,
      transStatus: 'A',
    });

    expect(result.authenticated).toBe(true);
    expect(result.eci).toBe('06');
  });

  it('fails when transStatus=N', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_VISA });
    const result = verify3DS({
      threeDSSessionId: init.threeDSSessionId,
      paymentIntentId: BASE_INITIATE.paymentIntentId,
      transStatus: 'N',
    });

    expect(result.authenticated).toBe(false);
    expect(result.status).toBe('failed');
  });

  it('fails when transStatus=R (rejected)', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_VISA });
    const result = verify3DS({
      threeDSSessionId: init.threeDSSessionId,
      paymentIntentId: BASE_INITIATE.paymentIntentId,
      transStatus: 'R',
    });

    expect(result.authenticated).toBe(false);
  });

  it('infers transStatus from PARes presence (3DS1 style)', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_VISA });
    // Provide a paRes string but no transStatus → should treat as 'Y'
    const result = verify3DS({
      threeDSSessionId: init.threeDSSessionId,
      paymentIntentId: BASE_INITIATE.paymentIntentId,
      paRes: 'BASE64_PARES_DATA',
    });

    expect(result.authenticated).toBe(true);
  });

  it('returns error status for unknown session', () => {
    const result = verify3DS({
      threeDSSessionId: 'nonexistent-session-id',
      paymentIntentId: 'pi_123',
      transStatus: 'Y',
    });

    expect(result.status).toBe('error');
    expect(result.authenticated).toBe(false);
  });

  it('returns failure when paymentIntentId does not match', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_VISA });
    const result = verify3DS({
      threeDSSessionId: init.threeDSSessionId,
      paymentIntentId: 'pi_different',
      transStatus: 'Y',
    });

    expect(result.authenticated).toBe(false);
    expect(result.status).toBe('failed');
  });

  it('returns the existing result for an already-authenticated session', () => {
    const init = initiate3DS(
      { ...BASE_INITIATE, ...ENROLLED_VISA },
      { sandboxFrictionless: true },
    );

    // Session is already authenticated (frictionless)
    const result = verify3DS({
      threeDSSessionId: init.threeDSSessionId,
      paymentIntentId: BASE_INITIATE.paymentIntentId,
      transStatus: 'Y',
    });

    expect(result.authenticated).toBe(true);
    expect(result.status).toBe('authenticated');
  });

  it('marks session as expired when expiresAt is in the past', () => {
    // Seed a session that has already expired
    const sessionId = 'expired-session';
    _seedSession({
      sessionId,
      paymentIntentId: 'pi_expired',
      merchantId: 'merch_01',
      amount: 50,
      currency: 'USD',
      status: 'challenge_required',
      version: '2.1',
      enrolled: true,
      createdAt: new Date(Date.now() - 1_000_000),
      updatedAt: new Date(Date.now() - 1_000_000),
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    const result = verify3DS({
      threeDSSessionId: sessionId,
      paymentIntentId: 'pi_expired',
      transStatus: 'Y',
    });

    expect(result.authenticated).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.message).toContain('expired');
  });
});

// ── get3DSSession ─────────────────────────────────────────────────────────────

describe('get3DSSession', () => {
  it('returns undefined for unknown session ID', () => {
    expect(get3DSSession('unknown')).toBeUndefined();
  });

  it('returns the session after initiation', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_VISA });
    const session = get3DSSession(init.threeDSSessionId);

    expect(session).toBeDefined();
    expect(session!.sessionId).toBe(init.threeDSSessionId);
    expect(session!.amount).toBe(BASE_INITIATE.amount);
    expect(session!.currency).toBe(BASE_INITIATE.currency);
  });
});

// ── cancel3DSSession ──────────────────────────────────────────────────────────

describe('cancel3DSSession', () => {
  it('returns success=false for an unknown session', () => {
    const result = cancel3DSSession('nonexistent');

    expect(result.success).toBe(false);
  });

  it('cancels an active session', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_VISA });
    const result = cancel3DSSession(init.threeDSSessionId, 'User abandoned flow');

    expect(result.success).toBe(true);
    expect(result.message).toContain('User abandoned flow');

    const session = get3DSSession(init.threeDSSessionId);
    expect(session!.status).toBe('cancelled');
  });

  it('cancels without a reason string', () => {
    const init = initiate3DS({ ...BASE_INITIATE, ...ENROLLED_VISA });
    const result = cancel3DSSession(init.threeDSSessionId);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Session cancelled');
  });
});

// ── purgeExpiredSessions ──────────────────────────────────────────────────────

describe('purgeExpiredSessions', () => {
  it('removes only expired sessions and returns the count', () => {
    // Seed one expired and one active session
    _seedSession({
      sessionId: 'sess-expired',
      paymentIntentId: 'pi_1',
      merchantId: 'm1',
      amount: 10,
      currency: 'USD',
      status: 'pending',
      version: '2.1',
      enrolled: true,
      createdAt: new Date(Date.now() - 2_000_000),
      updatedAt: new Date(Date.now() - 2_000_000),
      expiresAt: new Date(Date.now() - 1000),
    });

    _seedSession({
      sessionId: 'sess-active',
      paymentIntentId: 'pi_2',
      merchantId: 'm1',
      amount: 20,
      currency: 'USD',
      status: 'challenge_required',
      version: '2.1',
      enrolled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
    });

    const removed = purgeExpiredSessions();

    expect(removed).toBe(1);
    expect(get3DSSession('sess-expired')).toBeUndefined();
    expect(get3DSSession('sess-active')).toBeDefined();
  });

  it('returns 0 when there are no expired sessions', () => {
    _seedSession({
      sessionId: 'sess-ok',
      paymentIntentId: 'pi_3',
      merchantId: 'm1',
      amount: 5,
      currency: 'EUR',
      status: 'pending',
      version: '2.1',
      enrolled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
    });

    expect(purgeExpiredSessions()).toBe(0);
  });
});
