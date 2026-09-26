"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSecurityRateLimit = exports.validateInput = exports.contentSecurityPolicy = exports.sanitizeInput = exports.InputSanitizer = void 0;
var dompurify_1 = require("dompurify");
var validator_1 = require("validator");
var xss_1 = require("xss");
var escape_html_1 = require("escape-html");
var sqlstring_1 = require("sqlstring");
var InputSanitizer = /** @class */ (function () {
    function InputSanitizer() {
    }
    InputSanitizer.getInstance = function () {
        if (!InputSanitizer.instance) {
            InputSanitizer.instance = new InputSanitizer();
        }
        return InputSanitizer.instance;
    };
    /**
     * Main sanitization function
     */
    InputSanitizer.prototype.sanitize = function (input, options) {
        var _this = this;
        if (options === void 0) { options = {}; }
        var defaultOptions = {
            sqlEscape: true,
            sqlParameterize: true,
            xssProtection: true,
            htmlSanitization: true,
            escapeHtml: true,
            validateEmail: true,
            validateUrl: true,
            validateNumeric: true,
            commandEscape: true,
            customRules: []
        };
        var finalOptions = __assign(__assign({}, defaultOptions), options);
        if (typeof input === 'string') {
            return this.sanitizeString(input, finalOptions);
        }
        else if (Array.isArray(input)) {
            return input.map(function (item) { return _this.sanitize(item, finalOptions); });
        }
        else if (typeof input === 'object' && input !== null) {
            return this.sanitizeObject(input, finalOptions);
        }
        return input;
    };
    /**
     * Sanitize string values
     */
    InputSanitizer.prototype.sanitizeString = function (input, options) {
        var sanitized = input;
        // SQL Injection Prevention
        if (options.sqlEscape) {
            sanitized = this.escapeSql(sanitized);
        }
        // XSS Protection
        if (options.xssProtection) {
            sanitized = (0, xss_1.default)(sanitized);
        }
        // HTML Sanitization
        if (options.htmlSanitization) {
            sanitized = dompurify_1.default.sanitize(sanitized);
        }
        // HTML Escaping
        if (options.escapeHtml) {
            sanitized = (0, escape_html_1.default)(sanitized);
        }
        // Command Injection Prevention
        if (options.commandEscape) {
            sanitized = this.escapeCommands(sanitized);
        }
        // Apply custom rules
        if (options.customRules) {
            for (var _i = 0, _a = options.customRules; _i < _a.length; _i++) {
                var rule = _a[_i];
                sanitized = rule(sanitized);
            }
        }
        return sanitized;
    };
    /**
     * Sanitize object values recursively
     */
    InputSanitizer.prototype.sanitizeObject = function (obj, options) {
        var _this = this;
        var sanitized = {};
        for (var _i = 0, _a = Object.entries(obj); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], value = _b[1];
            // Sanitize key names to prevent key injection
            var sanitizedKey = this.sanitizeKey(key);
            if (value === null || value === undefined) {
                sanitized[sanitizedKey] = value;
            }
            else if (typeof value === 'string') {
                sanitized[sanitizedKey] = this.sanitizeString(value, options);
            }
            else if (Array.isArray(value)) {
                sanitized[sanitizedKey] = value.map(function (item) { return _this.sanitize(item, options); });
            }
            else if (typeof value === 'object') {
                sanitized[sanitizedKey] = this.sanitizeObject(value, options);
            }
            else {
                sanitized[sanitizedKey] = value;
            }
        }
        return sanitized;
    };
    /**
     * Sanitize object keys
     */
    InputSanitizer.prototype.sanitizeKey = function (key) {
        // Remove dangerous characters from keys
        return key.replace(/[^a-zA-Z0-9_]/g, '');
    };
    /**
     * SQL injection escape
     */
    InputSanitizer.prototype.escapeSql = function (input) {
        return sqlstring_1.default.escape(input).replace(/^'(.*)'$/, '$1');
    };
    /**
     * Command injection escape
     */
    InputSanitizer.prototype.escapeCommands = function (input) {
        // Remove dangerous shell characters
        var dangerousChars = ['|', '&', ';', '<', '>', '`', '$', '(', ')', '{', '}', '[', ']'];
        var escaped = input;
        for (var _i = 0, dangerousChars_1 = dangerousChars; _i < dangerousChars_1.length; _i++) {
            var char = dangerousChars_1[_i];
            escaped = escaped.replace(new RegExp("\\".concat(char), 'g'), "\\".concat(char));
        }
        return escaped;
    };
    /**
     * Validate and sanitize email
     */
    InputSanitizer.prototype.sanitizeEmail = function (email) {
        if (!validator_1.default.isEmail(email)) {
            return null;
        }
        return validator_1.default.normalizeEmail(email) || null;
    };
    /**
     * Validate and sanitize URL
     */
    InputSanitizer.prototype.sanitizeUrl = function (url) {
        if (!validator_1.default.isURL(url, { protocols: ['http', 'https'] })) {
            return null;
        }
        return validator_1.default.normalizeUrl(url);
    };
    /**
     * Validate and sanitize numeric input
     */
    InputSanitizer.prototype.sanitizeNumeric = function (input) {
        if (!validator_1.default.isNumeric(input)) {
            return null;
        }
        return parseFloat(input);
    };
    /**
     * Create parameterized SQL query
     */
    InputSanitizer.prototype.createParameterizedQuery = function (query, params) {
        var _this = this;
        var sanitizedParams = params.map(function (param) { return _this.sanitize(param, { sqlEscape: true }); });
        // Replace ? placeholders with proper parameterization
        var index = 0;
        var sql = query.replace(/\?/g, function () {
            if (index < sanitizedParams.length) {
                var param = sanitizedParams[index++];
                return typeof param === 'string' ? "'".concat(_this.escapeSql(param), "'") : String(param);
            }
            return '?';
        });
        return { sql: sql, values: sanitizedParams };
    };
    return InputSanitizer;
}());
exports.InputSanitizer = InputSanitizer;
/**
 * Express middleware for input sanitization
 */
var sanitizeInput = function (options) {
    if (options === void 0) { options = {}; }
    var sanitizer = InputSanitizer.getInstance();
    return function (req, res, next) {
        try {
            // Sanitize request body
            if (req.body) {
                req.body = sanitizer.sanitize(req.body, options);
            }
            // Sanitize query parameters
            if (req.query) {
                req.query = sanitizer.sanitize(req.query, options);
            }
            // Sanitize URL parameters
            if (req.params) {
                req.params = sanitizer.sanitize(req.params, options);
            }
            // Sanitize headers (excluding system headers)
            if (req.headers) {
                var safeHeaders = ['content-type', 'authorization', 'accept', 'user-agent'];
                for (var _i = 0, _a = Object.entries(req.headers); _i < _a.length; _i++) {
                    var _b = _a[_i], key = _b[0], value = _b[1];
                    if (safeHeaders.includes(key.toLowerCase()) && typeof value === 'string') {
                        req.headers[key] = sanitizer.sanitizeString(value, options);
                    }
                }
            }
            next();
        }
        catch (error) {
            console.error('Sanitization error:', error);
            res.status(400).json({
                error: 'Invalid input detected',
                message: 'Request contains malicious or malformed input'
            });
        }
    };
};
exports.sanitizeInput = sanitizeInput;
/**
 * Content Security Policy middleware
 */
var contentSecurityPolicy = function () {
    return function (req, res, next) {
        var csp = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: https: blob:",
            "connect-src 'self' https://api.stellar.org https://horizon-testnet.stellar.org",
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "upgrade-insecure-requests"
        ].join('; ');
        res.setHeader('Content-Security-Policy', csp);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
        next();
    };
};
exports.contentSecurityPolicy = contentSecurityPolicy;
/**
 * Input validation middleware using Zod schemas
 */
var validateInput = function (schema) {
    return function (req, res, next) {
        try {
            // Validate request body against schema
            if (req.body) {
                req.body = schema.parse(req.body);
            }
            // Validate query parameters
            if (req.query && schema.shape.query) {
                req.query = schema.shape.query.parse(req.query);
            }
            // Validate URL parameters
            if (req.params && schema.shape.params) {
                req.params = schema.shape.params.parse(req.params);
            }
            next();
        }
        catch (error) {
            console.error('Validation error:', error);
            res.status(400).json({
                error: 'Validation failed',
                message: 'Input does not match required format',
                details: error.errors
            });
        }
    };
};
exports.validateInput = validateInput;
/**
 * Rate limiting for brute force protection
 */
var createSecurityRateLimit = function (windowMs, max) {
    if (windowMs === void 0) { windowMs = 15 * 60 * 1000; }
    if (max === void 0) { max = 100; }
    var requests = new Map();
    return function (req, res, next) {
        var clientIp = req.ip || req.connection.remoteAddress || 'unknown';
        var now = Date.now();
        var windowStart = now - windowMs;
        // Clean up old entries
        for (var _i = 0, _a = requests.entries(); _i < _a.length; _i++) {
            var _b = _a[_i], ip = _b[0], data = _b[1];
            if (data.resetTime < now) {
                requests.delete(ip);
            }
        }
        // Get or create client data
        var clientData = requests.get(clientIp);
        if (!clientData) {
            clientData = { count: 0, resetTime: now + windowMs };
            requests.set(clientIp, clientData);
        }
        // Check if window has expired
        if (clientData.resetTime < now) {
            clientData.count = 0;
            clientData.resetTime = now + windowMs;
        }
        // Increment count
        clientData.count++;
        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - clientData.count));
        res.setHeader('X-RateLimit-Reset', new Date(clientData.resetTime).toISOString());
        // Check if limit exceeded
        if (clientData.count > max) {
            return res.status(429).json({
                error: 'Too many requests',
                message: 'Rate limit exceeded. Please try again later.',
                retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
            });
        }
        next();
    };
};
exports.createSecurityRateLimit = createSecurityRateLimit;
exports.default = InputSanitizer;
