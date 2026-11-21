// HMAC-SHA256 request signing middleware — Issue #510
//
// Server-to-server authentication via request signatures.
// Each request must include:
//   X-Signature:  hmac-sha256=<hex>
//   X-Timestamp:  <unix ms>
//   X-Nonce:      <unique per-request string>
//
// Signature payload: METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_SHA256
//
// Backward compatible: if HMAC headers are absent the middleware delegates to
// the existing API-key check by calling next() without error.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { auditService } from '../services/auditService.js';
import { getSharedRateLimitRedis } from '../config/rate-limit-redis.js';
import { AppError } from './errorHandler.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HEADER_SIGNATURE  = 'x-signature';
export const HEADER_TIMESTAMP  = 'x-timestamp';
export const HEADER_NONCE      = 'x-nonce';
export const REPLAY_WINDOW_MS  = 5 * 60 * 1000; // 5 minutes
const NONCE_TTL_SEC            = Math.ceil(REPLAY_WINDOW_MS / 1000) + 30;
const SIG_PREFIX               = 'hmac-sha256=';

// ---------------------------------------------------------------------------
// In-memory nonce store (single-instance fallback)
// ---------------------------------------------------------------------------

const usedNonces = new Map<string, number>(); // nonce → ts

setInterval(() => {
  const cutoff = Date.now() - REPLAY_WINDOW_MS;
  for (const [n, ts] of usedNonces) {
    if (ts < cutoff) usedNonces.delete(n);
  }
}, 60_000);

async function isNonceUsed(nonce: string): Promise<boolean> {
  try {
    const redis = await getSharedRateLimitRedis();
    if (redis) {
      const key = `hmac:nonce:${nonce}`;
      const existing = await redis.get(key);
      if (existing) return true;
      await redis.set(key, '1', 'EX', NONCE_TTL_SEC);
      return false;
    }
  } catch { /* fall through */ }
  if (usedNonces.has(nonce)) return true;
  usedNonces.set(nonce, Date.now());
  return false;
}

// ---------------------------------------------------------------------------
// Active signing keys (in-memory cache + DB)
// ---------------------------------------------------------------------------

interface CachedKey { keyId: string; secretHash: string; tenantId: string }

// Cache invalidated by explicit call or TTL (5 minutes)
const keyCache = new Map<string, { key: CachedKey; cachedAt: number }>();
const KEY_CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveSigningKey(keyId: string): Promise<CachedKey | null> {
  const cached = keyCache.get(keyId);
  if (cached && Date.now() - cached.cachedAt < KEY_CACHE_TTL_MS) return cached.key;

  const row = await prisma.signingKey.findUnique({
    where: { keyId },
    select: { keyId: true, secretHash: true, tenantId: true, isActive: true, expiresAt: true },
  });

  if (!row || !row.isActive) return null;
  if (row.expiresAt && new Date() > row.expiresAt) return null;

  const entry: CachedKey = { keyId: row.keyId, secretHash: row.secretHash, tenantId: row.tenantId };
  keyCache.set(keyId, { key: entry, cachedAt: Date.now() });
  return entry;
}

export function invalidateKeyCache(keyId?: string): void {
  if (keyId) keyCache.delete(keyId);
  else keyCache.clear();
}

// ---------------------------------------------------------------------------
// Signature computation
// ---------------------------------------------------------------------------

function bodyHash(body: Buffer | string): string {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '', 'utf8');
  return createHash('sha256').update(buf).digest('hex');
}

function buildPayload(method: string, path: string, timestamp: string, nonce: string, rawBody: Buffer | string): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash(rawBody)}`;
}

function computeHmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function hmacAuthMiddleware(opts: { required?: boolean } = {}) {
  return async function hmacAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const sigHeader = req.headers[HEADER_SIGNATURE] as string | undefined;
    const timestamp = req.headers[HEADER_TIMESTAMP] as string | undefined;
    const nonce = req.headers[HEADER_NONCE] as string | undefined;

    // Backward-compatible: if none of the HMAC headers are present, pass through
    if (!sigHeader && !timestamp && !nonce) {
      if (opts.required) {
        next(new AppError(401, 'HMAC signature headers required', 'HMAC_REQUIRED'));
        return;
      }
      next();
      return;
    }

    // All three headers required once any one is present
    if (!sigHeader || !timestamp || !nonce) {
      next(new AppError(401, 'Missing HMAC headers: X-Signature, X-Timestamp, X-Nonce all required', 'HMAC_INCOMPLETE'));
      return;
    }

    // Timestamp validation (±5 minutes)
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
      void auditService.logAction({ action: 'hmac.auth.failed', resource: 'hmac_auth', details: { reason: 'timestamp_skew' } });
      next(new AppError(401, 'Request timestamp outside acceptable window', 'HMAC_TIMESTAMP'));
      return;
    }

    // Nonce deduplication
    if (await isNonceUsed(nonce)) {
      void auditService.logAction({ action: 'hmac.auth.failed', resource: 'hmac_auth', details: { reason: 'nonce_replay', nonce } });
      next(new AppError(401, 'Nonce already used (replay detected)', 'HMAC_NONCE_REPLAY'));
      return;
    }

    // Parse key ID from signature header: "hmac-sha256=<hex>" or "kid=<id>;hmac-sha256=<hex>"
    let keyId: string | undefined;
    let sigHex: string;
    if (sigHeader.includes(';')) {
      const parts = sigHeader.split(';');
      const kidPart = parts.find(p => p.startsWith('kid='));
      const sigPart = parts.find(p => p.startsWith(SIG_PREFIX));
      keyId = kidPart?.split('=')[1];
      sigHex = sigPart?.slice(SIG_PREFIX.length) ?? '';
    } else if (sigHeader.startsWith(SIG_PREFIX)) {
      sigHex = sigHeader.slice(SIG_PREFIX.length);
    } else {
      next(new AppError(401, 'Malformed X-Signature header', 'HMAC_MALFORMED'));
      return;
    }

    // If no key ID in header, use tenant's first active key
    if (!keyId) {
      const tenantId = (req.headers['x-tenant-id'] as string) ?? 'default';
      const row = await prisma.signingKey.findFirst({
        where: { tenantId, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { keyId: true },
        orderBy: { createdAt: 'desc' },
      });
      keyId = row?.keyId;
    }

    if (!keyId) {
      next(new AppError(401, 'No active signing key', 'HMAC_NO_KEY'));
      return;
    }

    const keyRecord = await resolveSigningKey(keyId);
    if (!keyRecord) {
      void auditService.logAction({ action: 'hmac.auth.failed', resource: 'hmac_auth', details: { reason: 'key_not_found', keyId } });
      next(new AppError(401, 'Unknown or inactive signing key', 'HMAC_INVALID_KEY'));
      return;
    }

    // Verify signature
    const rawBody = (req as any).rawBody ?? req.body ?? '';
    const payload = buildPayload(req.method, req.originalUrl, timestamp, nonce, rawBody);
    const expected = computeHmac(keyRecord.secretHash, payload);

    let valid = false;
    try {
      const eBuf = Buffer.from(expected, 'hex');
      const sBuf = Buffer.from(sigHex, 'hex');
      valid = eBuf.length === sBuf.length && timingSafeEqual(eBuf, sBuf);
    } catch { /* invalid hex */ }

    if (!valid) {
      void auditService.logAction({ action: 'hmac.auth.failed', resource: 'hmac_auth', details: { reason: 'invalid_signature', keyId } });
      next(new AppError(401, 'Invalid HMAC signature', 'HMAC_INVALID_SIG'));
      return;
    }

    void auditService.logAction({
      action: 'hmac.auth.success',
      resource: 'hmac_auth',
      details: { keyId, method: req.method, path: req.path },
    });

    logger.debug({ keyId, path: req.path }, 'hmac auth: verified');
    (req as any).hmacKeyId = keyId;
    (req as any).hmacTenantId = keyRecord.tenantId;

    next();
  };
}
