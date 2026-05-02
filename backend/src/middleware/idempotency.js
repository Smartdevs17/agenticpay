"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearIdempotencyCache = exports.idempotency = void 0;
// In-memory cache for idempotency keys
var idempotencyCache = new Map();
// Default TTL is 24 hours (in milliseconds)
var DEFAULT_TTL = 24 * 60 * 60 * 1000;
var idempotency = function (ttl) {
    if (ttl === void 0) { ttl = DEFAULT_TTL; }
    return function (req, res, next) {
        var key = req.headers['x-idempotency-key'];
        if (!key) {
            // If no key is provided, proceed normally.
            return next();
        }
        // Include the original URL to scope the key per route
        var cacheKey = "".concat(req.method, ":").concat(req.originalUrl, ":").concat(key);
        var cached = idempotencyCache.get(cacheKey);
        if (cached) {
            if (Date.now() < cached.expiresAt) {
                // Return cached response instantly
                return res.status(cached.statusCode).json(cached.response);
            }
            else {
                // Expired, remove from cache and proceed
                idempotencyCache.delete(cacheKey);
            }
        }
        // Intercept res.json to capture the response
        var originalJson = res.json.bind(res);
        res.json = function (body) {
            // Cache the response if status is successful or we want to cache errors too
            // Usually we cache 2xx and 4xx responses, but 5xx might be transient.
            // For simplicity, we cache all completed responses that used this key.
            idempotencyCache.set(cacheKey, {
                response: body,
                statusCode: res.statusCode,
                expiresAt: Date.now() + ttl,
            });
            // Call the original res.json
            return originalJson(body);
        };
        next();
    };
};
exports.idempotency = idempotency;
// Exported for testing purposes
var clearIdempotencyCache = function () {
    idempotencyCache.clear();
};
exports.clearIdempotencyCache = clearIdempotencyCache;
