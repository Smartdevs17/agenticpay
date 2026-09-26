"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheTTL = void 0;
exports.cacheControl = cacheControl;
var node_crypto_1 = require("node:crypto");
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
exports.CacheTTL = {
    STATIC: 300,
    SHORT: 30,
    IMMUTABLE: 600,
    NONE: 0,
};
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
function cacheControl(options) {
    var maxAge = options.maxAge, _a = options.isPublic, isPublic = _a === void 0 ? true : _a, staleWhileRevalidate = options.staleWhileRevalidate;
    var cacheControlValue = buildCacheControlHeader(maxAge, isPublic, staleWhileRevalidate);
    return function cacheMiddleware(req, res, next) {
        // Only intercept cacheable methods
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
        }
        // Intercept res.json so we can inspect the body before it is sent
        var originalJson = res.json.bind(res);
        res.json = function jsonWithCache(body) {
            // Restore res.json immediately to avoid double-wrapping in nested calls
            res.json = originalJson;
            var bodyStr = JSON.stringify(body);
            var etag = computeETag(bodyStr);
            res.setHeader('Cache-Control', cacheControlValue);
            res.setHeader('ETag', etag);
            // Conditional GET — return 304 if client already has this version
            var clientETag = req.headers['if-none-match'];
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
function buildCacheControlHeader(maxAge, isPublic, staleWhileRevalidate) {
    if (maxAge === 0) {
        return 'no-store';
    }
    var directives = [
        isPublic ? 'public' : 'private',
        "max-age=".concat(maxAge),
    ];
    if (staleWhileRevalidate !== undefined && staleWhileRevalidate > 0) {
        directives.push("stale-while-revalidate=".concat(staleWhileRevalidate));
    }
    return directives.join(', ');
}
/**
 * Generates a strong ETag from the response body string.
 * Format: `"<first-16-hex-chars-of-SHA1>"` — compact but collision-resistant
 * enough for HTTP caching.
 */
function computeETag(body) {
    var hash = (0, node_crypto_1.createHash)('sha1').update(body).digest('hex').slice(0, 16);
    return "\"".concat(hash, "\"");
}
