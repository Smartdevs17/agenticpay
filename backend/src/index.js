"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var node_async_hooks_1 = require("node:async_hooks");
var node_crypto_1 = require("node:crypto");
var express_1 = require("express");
var cors_1 = require("cors");
var express_rate_limit_1 = require("express-rate-limit");
var compression_1 = require("compression");
var config_js_1 = require("./config.js");
var verification_js_1 = require("./routes/verification.js");
var invoice_js_1 = require("./routes/invoice.js");
var stellar_js_1 = require("./routes/stellar.js");
var catalog_js_1 = require("./routes/catalog.js");
var jobs_js_1 = require("./routes/jobs.js");
var health_js_1 = require("./routes/health.js");
var queue_js_1 = require("./routes/queue.js");
var sla_js_1 = require("./routes/sla.js");
var legacy_js_1 = require("./routes/legacy.js");
var splits_js_1 = require("./routes/splits.js");
var refunds_js_1 = require("./routes/refunds.js");
var allowances_js_1 = require("./routes/allowances.js");
var forms_js_1 = require("./routes/forms.js");
var index_js_1 = require("./jobs/index.js");
var errorHandler_js_1 = require("./middleware/errorHandler.js");
var queue_js_2 = require("./services/queue.js");
var queue_producers_js_1 = require("./services/queue-producers.js");
var slaTracking_js_1 = require("./middleware/slaTracking.js");
var requestId_js_1 = require("./middleware/requestId.js");
var env_js_1 = require("./config/env.js");
var email_js_1 = require("./routes/email.js");
var portfolio_js_1 = require("./routes/portfolio.js");
var backup_js_1 = require("./routes/backup.js");
var push_js_1 = require("./routes/push.js");
var ip_allowlist_js_1 = require("./routes/ip-allowlist.js");
var stripe_js_1 = require("./routes/stripe.js");
var ip_allowlist_js_2 = require("./middleware/ip-allowlist.js");
var notifications_js_1 = require("./routes/notifications.js");
var audit_js_1 = require("./routes/audit.js");
// Validate environment variables at startup
(0, env_js_1.validateEnv)();
var env = (0, env_js_1.config)();
// Initialize IP allowlist from environment
if (env.IP_ALLOWLIST_ENABLED || env.IP_ALLOWLIST) {
    var allowedIps = env.IP_ALLOWLIST ? env.IP_ALLOWLIST.split(',').map(function (ip) { return ip.trim(); }).filter(Boolean) : [];
    (0, ip_allowlist_js_2.initIpAllowlist)(allowedIps, env.IP_ALLOWLIST_ENABLED);
    console.log("[IP Allowlist] Enabled with ".concat(allowedIps.length, " IP(s)"));
}
var traceStorage = new node_async_hooks_1.AsyncLocalStorage();
var originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
};
function formatMessage(args) {
    var traceId = traceStorage.getStore();
    if (traceId) {
        if (typeof args[0] === 'string') {
            args[0] = "[TraceID: ".concat(traceId, "] ").concat(args[0]);
        }
        else {
            args.unshift("[TraceID: ".concat(traceId, "]"));
        }
    }
    return args;
}
console.log = function () {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    return originalConsole.log.apply(originalConsole, formatMessage(args));
};
console.info = function () {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    return originalConsole.info.apply(originalConsole, formatMessage(args));
};
console.warn = function () {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    return originalConsole.warn.apply(originalConsole, formatMessage(args));
};
console.error = function () {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    return originalConsole.error.apply(originalConsole, formatMessage(args));
};
var app = (0, express_1.default)();
var tierLimits = {
    free: config_js_1.config.rateLimit.free,
    pro: config_js_1.config.rateLimit.pro,
    enterprise: config_js_1.config.rateLimit.enterprise,
};
var tierWindowMs = config_js_1.config.rateLimit.windowMs;
var tierRateStore = new Map();
function resolveUserTier(req) {
    var _a;
    var headerTier = req.headers['x-user-tier'];
    var normalized = (_a = (Array.isArray(headerTier) ? headerTier[0] : headerTier)) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    if (normalized === 'pro' || normalized === 'enterprise') {
        return normalized;
    }
    return 'free';
}
function resolveClientIdentifier(req) {
    var authHeader = req.headers.authorization;
    if (authHeader) {
        return authHeader;
    }
    var apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string' && apiKey.trim() !== '') {
        return apiKey;
    }
    return req.ip || 'unknown-client';
}
function tieredRateLimit(req, res, next) {
    var tier = resolveUserTier(req);
    var limit = tierLimits[tier];
    var identifier = resolveClientIdentifier(req);
    var storeKey = "".concat(tier, ":").concat(identifier);
    var nowMs = Date.now();
    var existingState = tierRateStore.get(storeKey);
    var state = !existingState || existingState.resetAtMs <= nowMs
        ? { count: 0, resetAtMs: nowMs + tierWindowMs }
        : existingState;
    state.count += 1;
    tierRateStore.set(storeKey, state);
    var remaining = Math.max(0, limit - state.count);
    var resetInSeconds = Math.ceil((state.resetAtMs - nowMs) / 1000);
    res.setHeader('X-RateLimit-Tier', tier);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetInSeconds));
    if (state.count > limit) {
        res.status(429).json({
            error: {
                code: 'RATE_LIMIT_EXCEEDED',
                message: "Rate limit exceeded for tier '".concat(tier, "'"),
                status: 429,
            },
        });
        return;
    }
    next();
}
var invoiceLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use((0, cors_1.default)({
    origin: config_js_1.config.cors.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id', requestId_js_1.REQUEST_ID_HEADER],
}));
app.use(express_1.default.json());
app.use((0, compression_1.default)({
    threshold: config_js_1.config.compression.threshold,
    filter: function (req, res) {
        if (req.headers['x-no-compression']) {
            return false;
        }
        var contentType = res.getHeader('Content-Type');
        if (typeof contentType === 'string' && contentType.includes('application/json')) {
            return true;
        }
        if (Array.isArray(contentType) && contentType.some(function (ct) { return ct.includes('application/json'); })) {
            return true;
        }
        return compression_1.default.filter(req, res);
    },
}));
app.use(requestId_js_1.requestIdMiddleware);
app.use(function (req, res, next) {
    var traceId = req.headers['x-trace-id'] || (0, node_crypto_1.randomUUID)();
    res.setHeader('X-Trace-Id', traceId);
    traceStorage.run(traceId, function () {
        console.log("".concat(req.method, " ").concat(req.url, " [RequestID: ").concat(req.requestId, "] - Started"));
        res.on('finish', function () {
            console.log("".concat(req.method, " ").concat(req.url, " [RequestID: ").concat(req.requestId, "] - Finished with status ").concat(res.statusCode));
        });
        next();
    });
});
app.use(slaTracking_js_1.slaTrackingMiddleware);
app.use(function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Cache-Control', 'no-store');
    }
    res.setHeader('Vary', 'Accept-Encoding');
    next();
});
app.use(health_js_1.healthRouter);
var versioning_js_1 = require("./middleware/versioning.js");
app.use('/api/', tieredRateLimit);
app.use('/api/', versioning_js_1.versionMiddleware);
var apiV1Router = express_1.default.Router();
apiV1Router.use('/verification', verification_js_1.verificationRouter);
apiV1Router.use('/invoice', invoiceLimiter, invoice_js_1.invoiceRouter);
apiV1Router.use('/stellar', stellar_js_1.stellarRouter);
apiV1Router.use('/catalog', catalog_js_1.catalogRouter);
apiV1Router.use('/jobs', jobs_js_1.jobsRouter);
apiV1Router.use('/queue', queue_js_1.queueRouter);
apiV1Router.use('/sla', sla_js_1.slaRouter);
apiV1Router.use('/legacy', legacy_js_1.legacyRouter);
apiV1Router.use('/splits', splits_js_1.splitsRouter);
apiV1Router.use('/refunds', refunds_js_1.refundsRouter);
apiV1Router.use('/allowances', allowances_js_1.allowancesRouter);
apiV1Router.use('/forms', forms_js_1.formsRouter);
// Email delivery system
apiV1Router.use('/emails', email_js_1.emailRouter);
// Portfolio/wallet aggregation
apiV1Router.use('/portfolio', portfolio_js_1.portfolioRouter);
// Backup system
apiV1Router.use('/backup', backup_js_1.backupRouter);
// IP allowlist management
apiV1Router.use('/ip-allowlist', ip_allowlist_js_1.ipAllowlistRouter);
// Push notifications
apiV1Router.use('/push', push_js_1.pushRouter);
// Stripe card payments
apiV1Router.use('/stripe', stripe_js_1.stripeRouter);
app.use('/api/v1', (0, ip_allowlist_js_2.ipAllowlistMiddleware)(), apiV1Router);
// Notification system routes
app.use('/api/v1/notifications', notifications_js_1.notificationsRouter);
// Audit logging routes
app.use('/api/v1/audit', audit_js_1.auditRouter);
app.use('/api', function (req, res, next) {
    if (req.path.startsWith('/v1/')) {
        return next();
    }
    if (req.apiVersion === 'v1') {
        return apiV1Router(req, res, next);
    }
    next(new errorHandler_js_1.AppError(404, "API Version ".concat(req.apiVersion, " is not supported"), 'UNSUPPORTED_API_VERSION'));
});
app.use(errorHandler_js_1.notFoundHandler);
app.use(errorHandler_js_1.errorHandler);
if (config_js_1.config.jobs.enabled) {
    (0, index_js_1.startJobs)();
}
(0, queue_producers_js_1.registerDefaultProcessors)();
if (config_js_1.config.queue.enabled) {
    queue_js_2.messageQueue.start();
}
var server = app.listen(config_js_1.config.server.port, function () {
    console.log("AgenticPay backend running on port ".concat(config_js_1.config.server.port, " [").concat(config_js_1.config.env, "]"));
});
var shutdown = function (signal) {
    console.log("".concat(signal, " received. Starting graceful shutdown..."));
    server.close(function () {
        console.log('HTTP server closed.');
        try {
            var scheduler = (0, index_js_1.getJobScheduler)();
            if (scheduler) {
                scheduler.stopAll();
                console.log('Job scheduler stopped.');
            }
        }
        catch (err) {
            console.error('Error stopping scheduler:', err);
        }
        try {
            queue_js_2.messageQueue.stop();
            console.log('Message queue stopped.');
        }
        catch (err) {
            console.error('Error stopping message queue:', err);
        }
        console.log('Graceful shutdown complete. Exiting.');
        process.exit(0);
    });
    setTimeout(function () {
        console.error('Could not close connections in time, forceful shutdown');
        process.exit(1);
    }, 10000);
};
process.on('SIGTERM', function () { return shutdown('SIGTERM'); });
process.on('SIGINT', function () { return shutdown('SIGINT'); });
exports.default = app;
