import { Request, Response, NextFunction } from 'express';

interface CacheEntry {
  response: any;
  statusCode: number;
  expiresAt: number;
  completedAt: number;
}

/** In-flight request tracker — prevents two concurrent calls with same key racing each other. */
const inFlight = new Map<string, boolean>();

/** Completed response cache keyed by `METHOD:URL:idempotency-key`. */
const idempotencyCache = new Map<string, CacheEntry>();

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms
const MAX_KEY_LENGTH = 255;

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

export const idempotency = (ttl: number = DEFAULT_TTL) => {
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

    // --- Check completed-response cache ---
    const cached = idempotencyCache.get(cacheKey);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
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
        });
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
