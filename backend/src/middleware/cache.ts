/**
 * cache.ts
 *
 * cacheControl() — Express middleware factory for Cache-Control + ETag support.
 *
 * ## Usage
 *
 * ```ts
 * import { cacheControl, CacheTTL } from '../middleware/cache.js';
 *
 * router.get('/catalog', cacheControl({ maxAge: CacheTTL.STATIC }), handler);
 * ```
 *
 * ## What it does
 *
 * 1. Sets `Cache-Control` on the way out (public/private, max-age, optional
 *    stale-while-revalidate).
 * 2. Computes a strong ETag (SHA-1 of the serialised JSON body, first 16 hex
 *    chars) and attaches it to the response.
 * 3. Handles conditional requests: if the client sends `If-None-Match` with a
 *    matching ETag the middleware short-circuits and returns 304 Not Modified
 *    without re-sending the body.
 * 4. Only acts on GET and HEAD — POST / PUT / DELETE / PATCH are left alone.
 */

import { createHash } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CacheOptions {
  /**
   * How long (seconds) browsers and shared caches may serve a cached response.
   * Set to `0` to emit `Cache-Control: no-store` (disables caching entirely).
   */
  maxAge: number;

  /**
   * Whether to allow shared caches (CDNs, proxies) to store the response.
   * @default true
   */
  isPublic?: boolean;

  /**
   * Adds `stale-while-revalidate=N` so clients can serve stale content while
   * re-fetching in the background.
   */
  staleWhileRevalidate?: number;
}

// ─── Pre-configured TTLs ──────────────────────────────────────────────────────

/**
 * Convenience constants for common cache durations.
 *
 * | Constant    | Seconds | Typical use-case                              |
 * |-------------|---------|-----------------------------------------------|
 * | STATIC      | 300     | Catalog / configuration (rarely changes)      |
 * | SHORT       | 30      | Account balances, recent-state reads          |
 * | IMMUTABLE   | 600     | Confirmed transactions, completed verifications |
 * | NONE        | 0       | Mutations or user-specific sensitive data      |
 */
export const CacheTTL = {
  STATIC: 300,
  SHORT: 30,
  IMMUTABLE: 600,
  NONE: 0,
} as const;

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Returns an Express middleware that adds `Cache-Control` and `ETag` headers
 * to GET/HEAD responses, and responds with **304 Not Modified** when the
 * client already holds a fresh copy (via `If-None-Match`).
 *
 * @example
 * // Cache catalog for 5 minutes, allow CDN storage
 * router.get('/', cacheControl({ maxAge: CacheTTL.STATIC }), handler);
 *
 * @example
 * // Cache per-user data privately for 30 seconds
 * router.get('/me', cacheControl({ maxAge: CacheTTL.SHORT, isPublic: false }), handler);
 *
 * @example
 * // Disable caching explicitly
 * router.get('/live', cacheControl({ maxAge: CacheTTL.NONE }), handler);
 */
export function cacheControl(options: CacheOptions) {
  const { maxAge, isPublic = true, staleWhileRevalidate } = options;

  const cacheControlValue = buildCacheControlHeader(maxAge, isPublic, staleWhileRevalidate);

  return function cacheMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Only intercept cacheable methods
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    // Intercept res.json so we can inspect the body before it is sent
    const originalJson = res.json.bind(res);

    res.json = function jsonWithCache(body: unknown): Response {
      // Restore res.json immediately to avoid double-wrapping in nested calls
      res.json = originalJson;

      const bodyStr = JSON.stringify(body);
      const etag = computeETag(bodyStr);

      res.setHeader('Cache-Control', cacheControlValue);
      res.setHeader('ETag', etag);

      // Conditional GET — return 304 if client already has this version
      const clientETag = req.headers['if-none-match'];
      if (clientETag && clientETag === etag) {
        res.status(304).end();
        return res;
      }

      return originalJson(body);
    };

    next();
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCacheControlHeader(
  maxAge: number,
  isPublic: boolean,
  staleWhileRevalidate?: number,
): string {
  if (maxAge === 0) {
    return 'no-store';
  }

  const directives: string[] = [
    isPublic ? 'public' : 'private',
    `max-age=${maxAge}`,
  ];

  if (staleWhileRevalidate !== undefined && staleWhileRevalidate > 0) {
    directives.push(`stale-while-revalidate=${staleWhileRevalidate}`);
  }

  return directives.join(', ');
}

/**
 * Generates a strong ETag from the response body string.
 * Format: `"<first-16-hex-chars-of-SHA1>"` — compact but collision-resistant
 * enough for HTTP caching.
 */
function computeETag(body: string): string {
  const hash = createHash('sha1').update(body).digest('hex').slice(0, 16);
  return `"${hash}"`;
}
