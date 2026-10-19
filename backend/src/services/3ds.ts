/**
 * 3DS Authentication Service
 *
 * Implements the 3D Secure authentication flow for card payments.
 *
 * Supported spec versions:
 *   - 3DS 1.0.2 (legacy PARes/PAReq redirect flow)
 *   - EMV 3DS 2.1 / 2.2 (frictionless + challenge flows)
 *
 * In production this layer would delegate to a PSP SDK (Stripe, Adyen, Braintree…).
 * Here we provide a complete, deterministic implementation backed by in-memory
 * stores so the feature can be fully tested without external dependencies.
 */

import { randomUUID, createHmac } from 'node:crypto';
import {
  type Initiate3DSRequest,
  type Verify3DSRequest,
  type ThreeDSStatus,
  type ThreeDSVersion,
  type ThreeDSInitResponse,
  type ThreeDSVerifyResponse,
} from '../schemas/3ds.js';

// ── Internal types ────────────────────────────────────────────────────────────

export interface ThreeDSSession {
  sessionId: string;
  paymentIntentId: string;
  merchantId: string;
  customerId?: string;
  amount: number;
  currency: string;
  status: ThreeDSStatus;
  version: ThreeDSVersion;
  enrolled: boolean;
  acsUrl?: string;
  pareq?: string;
  creq?: string;
  eci?: string;
  authenticationValue?: string;
  transactionId?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface ThreeDSConfig {
  /** Session TTL in seconds (default 15 minutes) */
  sessionTtlSeconds?: number;
  /** Simulated ACS base URL used for test environments */
  acsBaseUrl?: string;
  /** Whether to force frictionless flow in sandbox mode */
  sandboxFrictionless?: boolean;
  /** HMAC secret for signing challenge data */
  hmacSecret?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TTL_SECONDS = 900; // 15 minutes
const DEFAULT_ACS_URL = 'https://acs.example.com/3ds/challenge';
const DEFAULT_HMAC_SECRET = 'threeds-dev-secret';

// ── In-memory store (replace with Redis / DB in production) ──────────────────

const sessions = new Map<string, ThreeDSSession>();

// ── Utilities ─────────────────────────────────────────────────────────────────

function now(): Date {
  return new Date();
}

function expiresAt(ttlSeconds: number): Date {
  return new Date(Date.now() + ttlSeconds * 1000);
}

/**
 * Determine whether a card BIN / number is enrolled in 3DS.
 *
 * In production this calls the Directory Server or your PSP's enrollment API.
 * Here we use a simple deterministic rule based on the last digit of the BIN so
 * that tests can control enrolment by choosing an appropriate card number.
 *
 *  BIN last digit even  → enrolled
 *  BIN last digit odd   → not enrolled
 */
function isCardEnrolled(cardBin: string): boolean {
  const lastDigit = parseInt(cardBin.slice(-1), 10);
  return lastDigit % 2 === 0;
}

/**
 * Derive a 6–8 digit BIN from whatever card identifier was supplied.
 */
function extractBin(req: Initiate3DSRequest): string {
  if (req.cardBin) return req.cardBin;
  if (req.cardNumber) return req.cardNumber.slice(0, 6);
  if (req.cardToken) {
    // Tokens are prefixed with the masked BIN: tok_<bin>_<rest>
    const parts = req.cardToken.split('_');
    if (parts.length >= 2 && /^\d{6,8}$/.test(parts[1])) {
      return parts[1];
    }
  }
  // Default to a deterministically enrolled BIN for test tokens
  return '400000';
}

/**
 * Select the 3DS spec version for this BIN.
 *
 * In reality this is returned by the Directory Server.  Here we map
 * BIN ranges to versions in a simple way for deterministic tests.
 */
function detectVersion(bin: string): ThreeDSVersion {
  const prefix = parseInt(bin.slice(0, 4), 10);
  if (prefix >= 5100 && prefix <= 5599) return '2.2'; // Mastercard range
  if (prefix >= 4000 && prefix <= 4999) return '2.1'; // Visa range
  return '1.0';
}

/**
 * Build a base64-encoded PAReq (3DS 1.x) for the ACS redirect.
 */
function buildPareq(session: ThreeDSSession, termUrl: string): string {
  const payload = JSON.stringify({
    MD: session.sessionId,
    PaReq: Buffer.from(
      `${session.paymentIntentId}:${session.amount}:${session.currency}`,
    ).toString('base64'),
    TermUrl: termUrl,
  });
  return Buffer.from(payload).toString('base64');
}

/**
 * Build a base64-encoded CReq (EMV 3DS 2.x) for the challenge window.
 */
function buildCreq(session: ThreeDSSession): string {
  const payload = JSON.stringify({
    messageType: 'CReq',
    messageVersion: session.version,
    threeDSServerTransID: session.transactionId,
    acsTransID: randomUUID(),
    challengeWindowSize: '05',
  });
  return Buffer.from(payload).toString('base64');
}

/**
 * Derive an ECI (Electronic Commerce Indicator) from the auth result.
 *
 *  Visa:       05 = fully authenticated, 06 = attempted, 07 = failed
 *  Mastercard: 02 = fully authenticated, 01 = attempted, 00 = failed
 */
function deriveEci(version: ThreeDSVersion, transStatus: string): string {
  // Use Visa coding for simplicity
  if (transStatus === 'Y') return '05';
  if (transStatus === 'A') return '06';
  return '07';
}

/**
 * Generate a deterministic Authentication Value (CAVV / AAV) for the session.
 */
function generateAuthValue(sessionId: string, hmacSecret: string): string {
  return createHmac('sha256', hmacSecret).update(sessionId).digest('base64');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initiate a 3DS authentication session for a card payment.
 */
export function initiate3DS(
  req: Initiate3DSRequest,
  cfg: ThreeDSConfig = {},
): ThreeDSInitResponse {
  const ttl = cfg.sessionTtlSeconds ?? DEFAULT_TTL_SECONDS;
  const acsBase = cfg.acsBaseUrl ?? DEFAULT_ACS_URL;
  const sandboxFrictionless = cfg.sandboxFrictionless ?? false;

  const bin = extractBin(req);
  const enrolled = isCardEnrolled(bin);
  const version = detectVersion(bin);
  const sessionId = randomUUID();
  const transactionId = randomUUID();
  const termUrl = `${req.returnUrl}?sessionId=${sessionId}`;

  const ts = now();

  const session: ThreeDSSession = {
    sessionId,
    paymentIntentId: req.paymentIntentId,
    merchantId: req.merchantId,
    customerId: req.customerId,
    amount: req.amount,
    currency: req.currency,
    status: enrolled ? 'pending' : 'not_enrolled',
    version,
    enrolled,
    transactionId,
    createdAt: ts,
    updatedAt: ts,
    expiresAt: expiresAt(ttl),
  };

  if (enrolled) {
    session.acsUrl = `${acsBase}?txn=${transactionId}`;

    if (version === '1.0') {
      session.pareq = buildPareq(session, termUrl);
      session.status = 'challenge_required';
    } else {
      // 3DS2 — if frictionless mode is forced (sandbox), skip challenge
      if (sandboxFrictionless) {
        session.status = 'authenticated';
        session.eci = '05';
        session.authenticationValue = generateAuthValue(
          sessionId,
          cfg.hmacSecret ?? DEFAULT_HMAC_SECRET,
        );
      } else {
        session.creq = buildCreq(session);
        session.status = 'challenge_required';
      }
    }
  }

  sessions.set(sessionId, session);

  return {
    threeDSSessionId: sessionId,
    status: session.status,
    version,
    acsUrl: session.acsUrl,
    pareq: session.pareq,
    creq: session.creq,
    termUrl: enrolled ? termUrl : undefined,
    enrolled,
    message: enrolled
      ? version === '1.0'
        ? 'Redirect cardholder to ACS'
        : sandboxFrictionless
          ? 'Frictionless authentication completed'
          : 'Present 3DS2 challenge window'
      : 'Card not enrolled in 3D Secure; proceed without authentication',
  };
}

/**
 * Verify the result of a completed 3DS challenge.
 */
export function verify3DS(
  req: Verify3DSRequest,
  cfg: ThreeDSConfig = {},
): ThreeDSVerifyResponse {
  const session = sessions.get(req.threeDSSessionId);

  if (!session) {
    return {
      threeDSSessionId: req.threeDSSessionId,
      paymentIntentId: req.paymentIntentId,
      status: 'error',
      authenticated: false,
      message: 'Session not found or expired',
    };
  }

  if (session.paymentIntentId !== req.paymentIntentId) {
    session.status = 'failed';
    session.updatedAt = now();
    sessions.set(session.sessionId, session);
    return {
      threeDSSessionId: session.sessionId,
      paymentIntentId: req.paymentIntentId,
      status: 'failed',
      authenticated: false,
      message: 'Payment intent mismatch',
    };
  }

  if (new Date() > session.expiresAt) {
    session.status = 'failed';
    session.updatedAt = now();
    sessions.set(session.sessionId, session);
    return {
      threeDSSessionId: session.sessionId,
      paymentIntentId: session.paymentIntentId,
      status: 'failed',
      authenticated: false,
      message: 'Session has expired',
    };
  }

  // If the session was already resolved (e.g. frictionless) return current state
  if (session.status === 'authenticated') {
    return {
      threeDSSessionId: session.sessionId,
      paymentIntentId: session.paymentIntentId,
      status: 'authenticated',
      eci: session.eci,
      authenticationValue: session.authenticationValue,
      transactionId: session.transactionId,
      authenticated: true,
      message: 'Already authenticated',
    };
  }

  // Determine the transStatus from the request
  const transStatus = req.transStatus ?? (req.paRes ? 'Y' : 'N');
  const authenticated = transStatus === 'Y' || transStatus === 'A';

  if (authenticated) {
    session.status = 'authenticated';
    session.eci = deriveEci(session.version, transStatus);
    session.authenticationValue = generateAuthValue(
      session.sessionId,
      cfg.hmacSecret ?? DEFAULT_HMAC_SECRET,
    );
  } else if (transStatus === 'C') {
    // Challenge still in progress — caller should not call verify yet
    session.status = 'challenge_required';
  } else {
    session.status = 'failed';
  }

  session.updatedAt = now();
  sessions.set(session.sessionId, session);

  return {
    threeDSSessionId: session.sessionId,
    paymentIntentId: session.paymentIntentId,
    status: session.status,
    eci: session.eci,
    authenticationValue: session.authenticationValue,
    transactionId: session.transactionId,
    authenticated,
    message: authenticated
      ? '3DS authentication successful'
      : `3DS authentication failed (transStatus=${transStatus})`,
  };
}

/**
 * Retrieve the current state of a 3DS session.
 */
export function get3DSSession(sessionId: string): ThreeDSSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Cancel an active 3DS session.
 */
export function cancel3DSSession(
  sessionId: string,
  reason?: string,
): { success: boolean; message: string } {
  const session = sessions.get(sessionId);
  if (!session) {
    return { success: false, message: 'Session not found' };
  }
  session.status = 'cancelled';
  session.updatedAt = now();
  sessions.set(sessionId, session);
  return {
    success: true,
    message: reason ? `Session cancelled: ${reason}` : 'Session cancelled',
  };
}

/**
 * Remove expired sessions (useful for a scheduled cleanup job).
 * Returns the number of sessions removed.
 */
export function purgeExpiredSessions(): number {
  const cutoff = now();
  let removed = 0;
  for (const [id, s] of sessions.entries()) {
    if (s.expiresAt < cutoff) {
      sessions.delete(id);
      removed++;
    }
  }
  return removed;
}

/**
 * Exposed for testing – allows pre-seeding a session.
 * @internal
 */
export function _seedSession(session: ThreeDSSession): void {
  sessions.set(session.sessionId, session);
}

/**
 * Exposed for testing – clears all sessions.
 * @internal
 */
export function _clearSessions(): void {
  sessions.clear();
}
