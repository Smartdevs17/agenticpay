/**
 * Fresh-signature gate for high-value withdrawals — issue #1486.
 *
 * A withdrawal at or above the high-value threshold must be re-authorised by
 * the requester at the moment of the request. The requester signs a canonical
 * payload that binds the HTTP method, path, a fresh timestamp, a single-use
 * nonce and the exact JSON body. A signature captured for one request cannot
 * be replayed against another route, body or time window.
 *
 * Headers (all required together):
 *   X-Fresh-Signature  hex HMAC-SHA256 over the canonical payload
 *   X-Fresh-Timestamp  request time, Unix milliseconds
 *   X-Fresh-Nonce      unique per request, 16–128 chars of [A-Za-z0-9_-]
 *
 * Canonical payload (newline-joined):
 *   FRESH-V1 \n METHOD \n PATH \n TIMESTAMP \n NONCE \n SHA256(JSON.stringify(body))
 *
 * Rejections are fail-closed: a high-value request whose signer has no
 * registered key is refused rather than allowed through.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errorHandler.js';
import { logger } from '../utils/logger.js';

export const HEADER_FRESH_SIGNATURE = 'x-fresh-signature';
export const HEADER_FRESH_TIMESTAMP = 'x-fresh-timestamp';
export const HEADER_FRESH_NONCE = 'x-fresh-nonce';

/** A signature older than this (or further in the future) is rejected. */
export const FRESH_SIGNATURE_MAX_AGE_MS = 2 * 60 * 1000;
/** Clock skew tolerated for timestamps slightly in the future. */
export const FRESH_SIGNATURE_MAX_SKEW_MS = 30 * 1000;

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;
const PAYLOAD_VERSION = 'FRESH-V1';

/** Default threshold in the same currency units as withdrawal amounts. */
export const DEFAULT_HIGH_VALUE_THRESHOLD = 10_000;

export function highValueThreshold(): number {
  const raw = process.env.HIGH_VALUE_WITHDRAWAL_THRESHOLD;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HIGH_VALUE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Signer key registry
// ---------------------------------------------------------------------------

const signerKeys = new Map<string, string>();

/** Register the HMAC secret a principal uses to sign fresh requests. */
export function registerFreshSignatureKey(principalId: string, secret: string): void {
  if (secret.length < 32) throw new Error('Fresh-signature secrets must be at least 32 characters');
  signerKeys.set(principalId, secret);
}

export function revokeFreshSignatureKey(principalId: string): void {
  signerKeys.delete(principalId);
}

export function clearFreshSignatureKeys(): void {
  signerKeys.clear();
}

// ---------------------------------------------------------------------------
// Replay protection (single-instance, in-memory)
// ---------------------------------------------------------------------------

const seenNonces = new Map<string, number>();

function pruneNonces(now: number): void {
  for (const [nonce, expiresAt] of seenNonces) {
    if (expiresAt <= now) seenNonces.delete(nonce);
  }
}

/** Returns true if the nonce was already used; otherwise records it. */
function consumeNonce(nonce: string, now: number): boolean {
  pruneNonces(now);
  if (seenNonces.has(nonce)) return true;
  seenNonces.set(nonce, now + FRESH_SIGNATURE_MAX_AGE_MS + FRESH_SIGNATURE_MAX_SKEW_MS);
  return false;
}

export function clearFreshSignatureNonces(): void {
  seenNonces.clear();
}

// ---------------------------------------------------------------------------
// Signature computation
// ---------------------------------------------------------------------------

export function canonicalFreshPayload(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: unknown
): string {
  const bodyDigest = createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
  return [PAYLOAD_VERSION, method.toUpperCase(), path, timestamp, nonce, bodyDigest].join('\n');
}

/** Helper for clients and tests: produce the header values for a request. */
export function signFreshRequest(params: {
  secret: string;
  method: string;
  path: string;
  body: unknown;
  timestamp: number;
  nonce: string;
}): Record<string, string> {
  const timestamp = String(params.timestamp);
  const payload = canonicalFreshPayload(params.method, params.path, timestamp, params.nonce, params.body);
  const signature = createHmac('sha256', params.secret).update(payload, 'utf8').digest('hex');
  return {
    [HEADER_FRESH_SIGNATURE]: signature,
    [HEADER_FRESH_TIMESTAMP]: timestamp,
    [HEADER_FRESH_NONCE]: params.nonce,
  };
}

/**
 * The path the client signed: the full mount path without the query string.
 * `req.path` is relative to the router that mounted this middleware, so it
 * would differ from what the client sees.
 */
export function fullPath(req: Request): string {
  return (req.originalUrl ?? req.url ?? '').split('?')[0];
}

function safeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  return aBuf.length === bBuf.length && aBuf.length > 0 && timingSafeEqual(aBuf, bBuf);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export interface FreshSignatureOptions {
  /** Principal whose key signs the request. Read from the body or params. */
  signerOf: (req: Request) => string | undefined;
  /** Amount the threshold applies to. `undefined` means not high-value. */
  amountOf: (req: Request) => number | undefined;
  /** Threshold at or above which a fresh signature is required. */
  threshold?: () => number;
  /** Clock source, injectable for tests. */
  now?: () => number;
}

function reject(req: Request, status: number, code: string, message: string): AppError {
  logger.warn(
    JSON.stringify({ event: 'withdrawal.fresh_signature_rejected', code, method: req.method, path: req.path })
  );
  return new AppError(status, message, code);
}

export function requireFreshSignature(options: FreshSignatureOptions) {
  const threshold = options.threshold ?? highValueThreshold;
  const now = options.now ?? Date.now;

  return function requireFreshSignatureMiddleware(req: Request, res: Response, next: NextFunction): void {
    const amount = options.amountOf(req);
    if (amount === undefined || !(amount >= threshold())) {
      next();
      return;
    }

    const signature = req.headers[HEADER_FRESH_SIGNATURE] as string | undefined;
    const timestamp = req.headers[HEADER_FRESH_TIMESTAMP] as string | undefined;
    const nonce = req.headers[HEADER_FRESH_NONCE] as string | undefined;

    if (!signature && !timestamp && !nonce) {
      next(reject(req, 401, 'FRESH_SIGNATURE_REQUIRED', 'High-value withdrawals require a fresh signature'));
      return;
    }
    if (!signature || !timestamp || !nonce) {
      next(reject(req, 401, 'FRESH_SIGNATURE_INCOMPLETE', 'X-Fresh-Signature, X-Fresh-Timestamp and X-Fresh-Nonce are all required'));
      return;
    }

    const signer = options.signerOf(req);
    const key = signer ? signerKeys.get(signer) : undefined;
    if (!key) {
      next(reject(req, 401, 'FRESH_SIGNATURE_UNKNOWN_SIGNER', 'No signing key is registered for this requester'));
      return;
    }

    if (!/^\d{1,15}$/.test(timestamp)) {
      next(reject(req, 401, 'FRESH_SIGNATURE_INVALID', 'Invalid X-Fresh-Timestamp'));
      return;
    }
    const ts = Number(timestamp);
    const current = now();
    if (ts > current + FRESH_SIGNATURE_MAX_SKEW_MS || current - ts > FRESH_SIGNATURE_MAX_AGE_MS) {
      next(reject(req, 401, 'FRESH_SIGNATURE_EXPIRED', 'Signature timestamp is outside the allowed window'));
      return;
    }

    if (!NONCE_PATTERN.test(nonce)) {
      next(reject(req, 401, 'FRESH_SIGNATURE_INVALID', 'Invalid X-Fresh-Nonce'));
      return;
    }
    if (!SIGNATURE_PATTERN.test(signature)) {
      next(reject(req, 401, 'FRESH_SIGNATURE_INVALID', 'Invalid X-Fresh-Signature'));
      return;
    }

    const expected = createHmac('sha256', key)
      .update(canonicalFreshPayload(req.method, fullPath(req), timestamp, nonce, req.body), 'utf8')
      .digest('hex');
    if (!safeEqualHex(signature, expected)) {
      next(reject(req, 401, 'FRESH_SIGNATURE_INVALID', 'Signature does not match the request'));
      return;
    }

    if (consumeNonce(nonce, current)) {
      next(reject(req, 409, 'FRESH_SIGNATURE_REPLAYED', 'This signature has already been used'));
      return;
    }

    next();
  };
}
