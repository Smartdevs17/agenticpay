"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearIdempotencyCache = exports.getIdempotencyCacheStats = exports.purgeExpiredIdempotencyKeys = exports.idempotency = void 0;

var inFlight = new Map();
var idempotencyCache = new Map();
var DEFAULT_TTL = 24 * 60 * 60 * 1000;
var MAX_KEY_LENGTH = 255;

function extractIdempotencyKey(req) {
    return req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
}

function validateKey(key) {
    if (key.length > MAX_KEY_LENGTH) {
        return "Idempotency-Key must not exceed ".concat(MAX_KEY_LENGTH, " characters.");
    }
    return null;
}

var idempotency = function (ttl) {
    if (ttl === void 0) { ttl = DEFAULT_TTL; }
    return function (req, res, next) {
        var key = extractIdempotencyKey(req);
        if (!key) {
            return next();
        }
        var validationError = validateKey(key);
        if (validationError) {
            return res.status(400).json({ error: 'invalid_idempotency_key', message: validationError });
        }
        var cacheKey = "".concat(req.method, ":").concat(req.originalUrl, ":").concat(key);
        var cached = idempotencyCache.get(cacheKey);
        if (cached) {
            if (Date.now() < cached.expiresAt) {
                return res.status(cached.statusCode).json(cached.response);
            }
            idempotencyCache.delete(cacheKey);
        }
        if (inFlight.get(cacheKey)) {
            return res.status(409).json({
                error: 'idempotency_key_in_use',
                message: 'A request with this Idempotency-Key is already being processed. Retry after it completes.',
            });
        }
        inFlight.set(cacheKey, true);
        var originalJson = res.json.bind(res);
        res.json = function (body) {
            inFlight.delete(cacheKey);
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
        res.on('close', function () {
            inFlight.delete(cacheKey);
        });
        next();
    };
};
exports.idempotency = idempotency;

var purgeExpiredIdempotencyKeys = function () {
    var now = Date.now();
    var purged = 0;
    idempotencyCache.forEach(function (entry, key) {
        if (now >= entry.expiresAt) {
            idempotencyCache.delete(key);
            purged++;
        }
    });
    return purged;
};
exports.purgeExpiredIdempotencyKeys = purgeExpiredIdempotencyKeys;

var getIdempotencyCacheStats = function () {
    return {
        cachedKeys: idempotencyCache.size,
        inFlightKeys: inFlight.size,
    };
};
exports.getIdempotencyCacheStats = getIdempotencyCacheStats;

var clearIdempotencyCache = function () {
    idempotencyCache.clear();
    inFlight.clear();
};
exports.clearIdempotencyCache = clearIdempotencyCache;
