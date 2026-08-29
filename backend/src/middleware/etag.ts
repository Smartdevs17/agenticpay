/**
 * ETag middleware — Issue #622
 *
 * Generates ETags for API responses and handles conditional requests
 * via If-None-Match headers, returning 304 Not Modified when appropriate.
 *
 * Features:
 *   - Content-based ETag generation (configurable hash algorithm)
 *   - Weak ETags for large payloads to reduce hashing cost
 *   - If-None-Match handling: comma-separated lists and `*` wildcard
 *   - Weak/strong comparison semantics per RFC 7232
 *   - 304 Not Modified responses for matching ETags
 *   - Cache bypass for authenticated requests (Bearer tokens and API keys)
 *   - Error responses (status >= 400) are never tagged or short-circuited
 *   - Composes safely with other ETag-emitting middleware (e.g. cacheControl)
 */

import { createHash } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ETagOptions {
  /** Hash algorithm used for ETag generation (default: sha256) */
  algorithm?: 'sha256' | 'sha1' | 'md5';
  /** Use weak ETags (W/"...") for semantic equivalence (default: false) */
  weak?: boolean;
  /** Threshold in bytes above which weak ETags are automatically used */
  weakThresholdBytes?: number;
  /** Skip ETag generation for responses larger than this (bytes) */
  maxBodySize?: number;
  /** Bypass ETag for authenticated requests (default: false) */
  bypassAuthenticated?: boolean;
}

export interface ETagMetrics {
  generated: number;
  matched: number;
  mismatched: number;
  bypassed: number;
  collisions: number;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_ALGORITHM = 'sha256';
const DEFAULT_WEAK_THRESHOLD = 1_048_576; // 1 MiB
const DEFAULT_MAX_BODY_SIZE = 10_485_760; // 10 MiB
const HASH_DIGEST_LENGTH = 32; // hex chars retained from the hash

// ─── Metrics ──────────────────────────────────────────────────────────────────

const metrics: ETagMetrics = {
  generated: 0,
  matched: 0,
  mismatched: 0,
  bypassed: 0,
  collisions: 0,
};

export function getETagMetrics(): ETagMetrics {
  return { ...metrics };
}

export function resetETagMetrics(): void {
  metrics.generated = 0;
  metrics.matched = 0;
  metrics.mismatched = 0;
  metrics.bypassed = 0;
  metrics.collisions = 0;
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Generate an ETag from response body content.
 * Uses a truncated hash to keep headers compact while remaining collision-resistant.
 */
export function generateETag(
  body: string | Buffer,
  algorithm: string = DEFAULT_ALGORITHM,
  weak: boolean = false,
): string {
  const hash = createHash(algorithm)
    .update(body)
    .digest('hex')
    .slice(0, HASH_DIGEST_LENGTH);
  return weak ? `W/"${hash}"` : `"${hash}"`;
}

/**
 * Parse the If-None-Match header into a list of ETags.
 * Handles `*` wildcard and comma-separated values.
 */
export function parseIfNoneMatch(header: string | undefined): string[] {
  if (!header) return [];
  if (header.trim() === '*') return ['*'];
  return header
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Perform weak comparison: strips the W/ prefix before comparing.
 * Per RFC 7232 §2.3.2, weak comparison ignores the weakness indicator.
 */
export function weakMatch(etagA: string, etagB: string): boolean {
  const strip = (t: string) => t.replace(/^W\//, '');
  return strip(etagA) === strip(etagB);
}

/**
 * Perform strong comparison: both ETags must be identical (no weak prefix).
 * Per RFC 7232 §2.3.1.
 */
export function strongMatch(etagA: string, etagB: string): boolean {
  return etagA === etagB && !etagA.startsWith('W/');
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/** True when a request carries credentials of any kind. */
function carriesCredentials(req: Request): boolean {
  return Boolean(req.headers.authorization || req.headers['x-api-key']);
}

/**
 * Express middleware that adds ETag headers and handles conditional requests.
 *
 * For GET/HEAD requests:
 *   - Generates an ETag from the serialised response body
 *   - Returns 304 Not Modified when the client's If-None-Match matches
 *
 * Mutations (POST/PUT/PATCH/DELETE) are passed through without ETag logic.
 * If another middleware (or route) already set an ETag header, this middleware
 * honours it instead of generating a conflicting one.
 */
export function etag(options: ETagOptions = {}) {
  const {
    algorithm = DEFAULT_ALGORITHM,
    weak = false,
    weakThresholdBytes = DEFAULT_WEAK_THRESHOLD,
    maxBodySize = DEFAULT_MAX_BODY_SIZE,
    bypassAuthenticated = false,
  } = options;

  return function etagMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Only apply to safe methods
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    // Optionally bypass for authenticated requests
    if (bypassAuthenticated && carriesCredentials(req)) {
      metrics.bypassed++;
      next();
      return;
    }

    const originalJson = res.json.bind(res);

    res.json = function etagJson(body: unknown): Response {
      res.json = originalJson;

      // Never tag or short-circuit error responses
      if (res.statusCode >= 400) {
        metrics.bypassed++;
        return originalJson(body);
      }

      // If an upstream middleware already tagged this response, defer to it
      const existingHeader = res.getHeader('ETag');
      const existing = Array.isArray(existingHeader) ? existingHeader[0] : existingHeader;

      const bodyStr = JSON.stringify(body);

      // Skip ETag for oversized responses
      if (bodyStr.length > maxBodySize) {
        metrics.bypassed++;
        return originalJson(body);
      }

      // Determine if we should use a weak ETag
      const useWeak = weak || bodyStr.length > weakThresholdBytes;

      const tag =
        typeof existing === 'string' && existing.length > 0
          ? existing
          : generateETag(bodyStr, algorithm, useWeak);

      if (typeof existing !== 'string' || existing.length === 0) {
        metrics.generated++;
      }

      res.setHeader('ETag', tag);

      // Check If-None-Match
      const clientETags = parseIfNoneMatch(req.headers['if-none-match'] as string);
      if (clientETags.length > 0) {
        const matched = clientETags.some(
          (clientTag) => clientTag === '*' || weakMatch(clientTag, tag),
        );

        if (matched) {
          metrics.matched++;
          res.status(304).end();
          return res;
        }
        metrics.mismatched++;
      }

      return originalJson(body);
    };

    next();
  };
}

/**
 * Convenience preset: attach ETag to all GET responses with no special options.
 */
export const defaultETag = () => etag();

/**
 * Convenience preset: ETag with authenticated-request bypass.
 */
export const publicETag = () =>
  etag({ bypassAuthenticated: true, weak: false });