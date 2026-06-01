import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { auditService } from '../services/auditService.js';

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5-minute window
const SIG_ALGO = 'sha256';

export const HEADER_SIGNATURE = 'x-internal-signature';
export const HEADER_TIMESTAMP = 'x-internal-timestamp';
export const HEADER_KEY_ID = 'x-internal-key-id';

interface SigningKey {
  id: string;
  secret: string;
  /** Unix ms — key not valid before this time */
  validFrom: number;
  /** Unix ms — key not valid at or after this time (absent = no expiry) */
  validUntil?: number;
}

const signingKeys = new Map<string, SigningKey>();
/** Replay-prevention: maps `keyId:timestamp:sig` → request timestamp */
const usedTokens = new Map<string, number>();

export function addSigningKey(key: SigningKey): void {
  signingKeys.set(key.id, key);
}

export function removeSigningKey(id: string): void {
  signingKeys.delete(id);
}

/** Load keys from INTERNAL_API_SIGNING_KEYS env var (JSON array of SigningKey).
 *  Falls back to a single key from INTERNAL_API_SECRET (or a generated dev secret). */
export function initSigningKeys(): void {
  const raw = process.env.INTERNAL_API_SIGNING_KEYS;
  if (raw) {
    try {
      const keys = JSON.parse(raw) as SigningKey[];
      for (const k of keys) addSigningKey(k);
      return;
    } catch { /* fall through to single-key fallback */ }
  }
  addSigningKey({
    id: 'default',
    secret: process.env.INTERNAL_API_SECRET ?? randomBytes(32).toString('hex'),
    validFrom: 0,
  });
}

function buildPayload(method: string, url: string, timestamp: string, body: string): string {
  return `${method.toUpperCase()}\n${url}\n${timestamp}\n${body}`;
}

function computeHmac(secret: string, data: string): string {
  return createHmac(SIG_ALGO, secret).update(data, 'utf8').digest('hex');
}

/** Returns headers to attach when calling an internal service. */
export function signRequest(params: {
  method: string;
  url: string;
  body?: unknown;
  keyId?: string;
}): Record<string, string> {
  const keyId = params.keyId ?? [...signingKeys.keys()][0];
  if (!keyId) throw new Error('No internal signing key configured');
  const key = signingKeys.get(keyId);
  if (!key) throw new Error(`Unknown signing key: ${keyId}`);

  const timestamp = Date.now().toString();
  const bodyStr = params.body !== undefined ? JSON.stringify(params.body) : '';
  const signature = computeHmac(key.secret, buildPayload(params.method, params.url, timestamp, bodyStr));

  return {
    [HEADER_KEY_ID]: keyId,
    [HEADER_TIMESTAMP]: timestamp,
    [HEADER_SIGNATURE]: signature,
  };
}

// Evict expired replay tokens every minute
setInterval(() => {
  const cutoff = Date.now() - REPLAY_WINDOW_MS;
  for (const [k, ts] of usedTokens) {
    if (ts < cutoff) usedTokens.delete(k);
  }
}, 60_000);

/** Express middleware — rejects requests without a valid HMAC signature. */
export function verifyInternalSignature(req: Request, res: Response, next: NextFunction): void {
  const keyId = req.headers[HEADER_KEY_ID] as string | undefined;
  const timestamp = req.headers[HEADER_TIMESTAMP] as string | undefined;
  const signature = req.headers[HEADER_SIGNATURE] as string | undefined;

  if (!keyId || !timestamp || !signature) {
    res.status(401).json({ error: 'Missing internal signature headers' });
    return;
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
    void auditService.logAction({ action: 'internal_api.auth.failed', resource: 'internal_api', details: { reason: 'timestamp_out_of_window', keyId } });
    res.status(401).json({ error: 'Request timestamp outside acceptable window' });
    return;
  }

  const replayToken = `${keyId}:${timestamp}:${signature}`;
  if (usedTokens.has(replayToken)) {
    void auditService.logAction({ action: 'internal_api.auth.failed', resource: 'internal_api', details: { reason: 'replay_detected', keyId } });
    res.status(401).json({ error: 'Replay detected' });
    return;
  }

  const key = signingKeys.get(keyId);
  if (!key) {
    void auditService.logAction({ action: 'internal_api.auth.failed', resource: 'internal_api', details: { reason: 'unknown_key', keyId } });
    res.status(401).json({ error: 'Unknown key ID' });
    return;
  }

  const now = Date.now();
  if (now < key.validFrom || (key.validUntil !== undefined && now >= key.validUntil)) {
    void auditService.logAction({ action: 'internal_api.auth.failed', resource: 'internal_api', details: { reason: 'key_expired', keyId } });
    res.status(401).json({ error: 'Signing key not valid at this time' });
    return;
  }

  const bodyStr = req.body !== undefined ? JSON.stringify(req.body) : '';
  const expected = computeHmac(key.secret, buildPayload(req.method, req.originalUrl, timestamp, bodyStr));

  let valid = false;
  try {
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    valid = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
  } catch { /* invalid hex in signature */ }

  if (!valid) {
    void auditService.logAction({ action: 'internal_api.auth.failed', resource: 'internal_api', details: { reason: 'invalid_signature', keyId } });
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  usedTokens.set(replayToken, ts);
  void auditService.logAction({
    action: 'internal_api.auth.success',
    resource: 'internal_api',
    details: { keyId, method: req.method, url: req.originalUrl },
  });
  next();
}
