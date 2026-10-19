import { createHash } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

interface CacheEntry {
  response: any;
  statusCode: number;
  expiresAt: number;
  completedAt: number;
  /** SHA-256 of the request that produced this entry; detects key reuse with a different payload. */
  fingerprint: string;
}

/** In-flight request tracker — prevents two concurrent calls with same key racing each other. */
const inFlight = new Map<string, boolean>();

/** Completed response cache keyed by `METHOD:URL:idempotency-key`. */
const idempotencyCache = new Map<string, CacheEntry>();

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms
const MAX_KEY_LENGTH = 255;

/** Hard cap on cached responses so a flood of unique keys cannot exhaust memory. */
export const DEFAULT_MAX_CACHE_ENTRIES = 10_000;

/** Accepts both the standard `Idempotency-Key` and legacy `X-Idempotency-Key` headers. */
function extractIdempotencyKey(req: Request): string | undefined {
  return (
    (req.headers['idempotency-key'] as string | undefined) ??
    (req.headers['x-idempotency-key'] as string | undefined)
  );
}

function validateKey(key: string): string | null {
  if (key.length > MAX_KEY_LENGTH) {
    return `Idempotency-Key must not exceed ${MAX_KEY_LENGTH} characters.`;
  }
  return null;
}

/**
 * Serialises a value with object keys sorted, so `{a:1,b:2}` and `{b:2,a:1}`
 * produce the same string. Without this, a client that re-serialises its payload
 * with different key ordering would look like a different request.
 */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

/**
 * Fingerprints the parts of a request that must not change when an idempotency key
 * is reused. The route is already part of the cache key, so only the body matters.
 */
export function fingerprintRequest(req: Pick<Request, 'body'>): string {
  return createHash('sha256').update(stableStringify(req.body)).digest('hex');
}

/** Evicts the oldest entries once the cache exceeds `maxEntries`. */
function enforceCacheLimit(maxEntries: number): void {
  while (idempotencyCache.size > maxEntries) {
    const oldest = idempotencyCache.keys().next();
    if (oldest.done) return;
    idempotencyCache.delete(oldest.value);
  }
}

export const idempotency = (ttl: number = DEFAULT_TTL, maxEntries: number = DEFAULT_MAX_CACHE_ENTRIES) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = extractIdempotencyKey(req);

    if (!key) {
      return next();
    }

    const validationError = validateKey(key);
    if (validationError) {
      return res.status(400).json({ error: 'invalid_idempotency_key', message: validationError });
    }

    // Scope the cache key to method + route so the same UUID can't be reused across endpoints
    const cacheKey = `${req.method}:${req.originalUrl}:${key}`;
    const fingerprint = fingerprintRequest(req);

    // --- Check completed-response cache ---
    const cached = idempotencyCache.get(cacheKey);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        // Reusing a key with a different payload would silently replay the earlier
        // response — the caller believes it created a new resource but got the old one.
        if (cached.fingerprint !== fingerprint) {
          return res.status(409).json({
            error: 'idempotency_key_reuse_mismatch',
            message:
              'This Idempotency-Key was already used with a different request body. Use a new key for a different request.',
          });
        }
        return res.status(cached.statusCode).json(cached.response);
      }
      idempotencyCache.delete(cacheKey);
    }

    // --- Collision detection: same key already in-flight ---
    if (inFlight.get(cacheKey)) {
      return res.status(409).json({
        error: 'idempotency_key_in_use',
        message:
          'A request with this Idempotency-Key is already being processed. Retry after it completes.',
      });
    }

    inFlight.set(cacheKey, true);

    // Intercept res.json to persist the final response
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      inFlight.delete(cacheKey);

      // Cache 2xx and 4xx (client errors); skip 5xx as they may be transient
      if (res.statusCode < 500) {
        idempotencyCache.set(cacheKey, {
          response: body,
          statusCode: res.statusCode,
          expiresAt: Date.now() + ttl,
          completedAt: Date.now(),
          fingerprint,
        });
        enforceCacheLimit(maxEntries);
      }

      return originalJson(body);
    };

    // Clear in-flight marker on premature connection close (no response sent)
    res.on('close', () => {
      inFlight.delete(cacheKey);
    });

    next();
  };
};

/**
 * Removes all cache entries whose TTL has expired.
 * Call this from a scheduled job (e.g. every hour) to bound memory usage.
 */
export function purgeExpiredIdempotencyKeys(): number {
  const now = Date.now();
  let purged = 0;
  for (const [cacheKey, entry] of idempotencyCache) {
    if (now >= entry.expiresAt) {
      idempotencyCache.delete(cacheKey);
      purged++;
    }
  }
  return purged;
}

/** Returns a snapshot of current cache stats for monitoring. */
export function getIdempotencyCacheStats() {
  return {
    cachedKeys: idempotencyCache.size,
    inFlightKeys: inFlight.size,
  };
}

/** Exported for testing purposes. */
export const clearIdempotencyCache = () => {
  idempotencyCache.clear();
  inFlight.clear();
};