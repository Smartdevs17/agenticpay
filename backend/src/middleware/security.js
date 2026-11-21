"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityMonitor = exports.InputValidation = exports.XSSPrevention = exports.CommandInjectionPrevention = exports.SQLInjectionPrevention = exports.SecurityMiddleware = void 0;
var helmet_1 = require("helmet");
var express_rate_limit_1 = require("express-rate-limit");
var sanitize_1 = require("./sanitize");
/**
 * Comprehensive Security Middleware Stack
 * Implements defense-in-depth security measures
 */
var SecurityMiddleware = /** @class */ (function () {
    function SecurityMiddleware() {
        this.sanitizer = sanitize_1.InputSanitizer.getInstance();
    }
    SecurityMiddleware.getInstance = function () {
        if (!SecurityMiddleware.instance) {
            SecurityMiddleware.instance = new SecurityMiddleware();
        }
        return SecurityMiddleware.instance;
    };
    /**
     * Apply all security middleware
     */
    SecurityMiddleware.prototype.applySecurity = function (app) {
        // 1. Helmet for basic security headers
        app.use((0, helmet_1.default)({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://vercel.live"],
                    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                    fontSrc: ["'self'", "https://fonts.gstatic.com"],
                    imgSrc: ["'self'", "data:", "https:", "blob:"],
                    connectSrc: ["'self'", "https://api.stellar.org", "https://horizon-testnet.stellar.org"],
                    frameSrc: ["'none'"],
                    objectSrc: ["'none'"],
                    baseUri: ["'self'"],
                    formAction: ["'self'"],
                    frameAncestors: ["'none'"],
                    upgradeInsecureRequests: []
                }
            },
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            }
        }));
        // 2. Content Security Policy
        app.use((0, sanitize_1.contentSecurityPolicy)());
        // 3. Rate limiting
        app.use(this.createRateLimits());
        // 4. Input sanitization
        app.use((0, sanitize_1.sanitizeInput)({
            sqlEscape: true,
            xssProtection: true,
            htmlSanitization: true,
            commandEscape: true
        }));
        // 5. Request logging for security monitoring
        app.use(this.securityLogger);
    };
    /**
     * Create rate limiting middleware
     */
    SecurityMiddleware.prototype.createRateLimits = function () {
        // General rate limit
        var generalLimit = (0, express_rate_limit_1.default)({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // limit each IP to 100 requests per windowMs
            message: {
                error: 'Too many requests',
                message: 'Rate limit exceeded. Please try again later.'
            },
            standardHeaders: true,
            legacyHeaders: false,
        });
        // Strict rate limit for sensitive endpoints
        var strictLimit = (0, express_rate_limit_1.default)({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 10, // limit each IP to 10 requests per windowMs
            message: {
                error: 'Too many requests',
                message: 'Rate limit exceeded for sensitive operations.'
            },
            standardHeaders: true,
            legacyHeaders: false,
        });
        return function (req, res, next) {
            // Apply strict limit to sensitive endpoints
            var sensitivePaths = [
                '/api/v1/auth/login',
                '/api/v1/auth/register',
                '/api/v1/verification/verify',
                '/api/v1/invoice/create'
            ];
            var isSensitive = sensitivePaths.some(function (path) { return req.path.startsWith(path); });
            if (isSensitive) {
                return strictLimit(req, res, next);
            }
            else {
                return generalLimit(req, res, next);
            }
        };
    };
    /**
     * Security request logger
     */
    SecurityMiddleware.prototype.securityLogger = function (req, res, next) {
        var startTime = Date.now();
        // Log potentially dangerous requests
        var suspiciousPatterns = [
            /\b(select|insert|update|delete|drop|union|exec|script)\b/i,
            /<script[^>]*>.*?<\/script>/gi,
            /javascript:/gi,
            /on\w+\s*=/gi,
            /['"]\s*;\s*['"]/gi,
            /\.\.\//g
        ];
        var isSuspicious = suspiciousPatterns.some(function (pattern) {
            return pattern.test(JSON.stringify({
                body: req.body,
                query: req.query,
                params: req.params
            }));
        });
        if (isSuspicious) {
            console.warn('🚨 Suspicious request detected:', {
                ip: req.ip,
                method: req.method,
                path: req.path,
                userAgent: req.get('User-Agent'),
                timestamp: new Date().toISOString(),
                body: req.body,
                query: req.query,
                params: req.params
            });
        }
        // Continue with request
        res.on('finish', function () {
            var duration = Date.now() - startTime;
            if (isSuspicious || res.statusCode >= 400) {
                console.warn('🔒 Security event:', {
                    ip: req.ip,
                    method: req.method,
                    path: req.path,
                    statusCode: res.statusCode,
                    duration: duration,
                    timestamp: new Date().toISOString()
                });
            }
        });
        next();
    };
    return SecurityMiddleware;
}());
exports.SecurityMiddleware = SecurityMiddleware;
/**
 * SQL Injection Prevention Helper
 */
var SQLInjectionPrevention = /** @class */ (function () {
    function SQLInjectionPrevention() {
    }
    /**
     * Validate SQL query parameters
     */
    SQLInjectionPrevention.validateQueryParams = function (params) {
        var dangerousPatterns = [
            /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|EXEC|SCRIPT)\b)/i,
            /(\b(OR|AND)\s+\d+\s*=\s*\d+)/i,
            /(--|\/\*|\*\/|;)/,
            /(\b(WAITFOR|DELAY)\b)/i,
            /(\b(BENCHMARK|SLEEP)\b)/i
        ];
        for (var _i = 0, params_1 = params; _i < params_1.length; _i++) {
            var param = params_1[_i];
            if (typeof param === 'string') {
                for (var _a = 0, dangerousPatterns_1 = dangerousPatterns; _a < dangerousPatterns_1.length; _a++) {
                    var pattern = dangerousPatterns_1[_a];
                    if (pattern.test(param)) {
                        console.warn('🚨 Potential SQL injection detected:', param);
                        return false;
                    }
                }
            }
        }
        return true;
    };
    /**
     * Create safe SQL query with parameterization
     */
    SQLInjectionPrevention.createSafeQuery = function (template, params) {
        if (!this.validateQueryParams(params)) {
            throw new Error('Invalid SQL parameters detected');
        }
        // Simple parameterization (in production, use proper ORM)
        var query = template;
        var paramIndex = 0;
        // Replace placeholders with safe parameters
        query = query.replace(/\?/g, function () {
            if (paramIndex < params.length) {
                var param = params[paramIndex++];
                return typeof param === 'string' ? "'".concat(param.replace(/'/g, "''"), "'") : String(param);
            }
            return '?';
        });
        return { query: query, safeParams: params };
    };
    return SQLInjectionPrevention;
}());
exports.SQLInjectionPrevention = SQLInjectionPrevention;
/**
 * Command Injection Prevention
 */
var CommandInjectionPrevention = /** @class */ (function () {
    function CommandInjectionPrevention() {
    }
    /**
     * Check for command injection attempts
     */
    CommandInjectionPrevention.detectCommandInjection = function (input) {
        var lowerInput = input.toLowerCase();
        // Check for dangerous commands
        for (var _i = 0, _a = this.dangerousCommands; _i < _a.length; _i++) {
            var command = _a[_i];
            if (lowerInput.includes(command)) {
                console.warn('🚨 Dangerous command detected:', command);
                return true;
            }
        }
        // Check for dangerous characters
        for (var _b = 0, _c = this.dangerousChars; _b < _c.length; _b++) {
            var char = _c[_b];
            if (input.includes(char)) {
                console.warn('🚨 Dangerous character detected:', char);
                return true;
            }
        }
        return false;
    };
    /**
     * Sanitize command arguments
     */
    CommandInjectionPrevention.sanitizeCommandArgs = function (args) {
        var _this = this;
        return args.map(function (arg) {
            // Remove dangerous characters
            var sanitized = arg;
            for (var _i = 0, _a = _this.dangerousChars; _i < _a.length; _i++) {
                var char = _a[_i];
                sanitized = sanitized.replace(new RegExp("\\".concat(char), 'g'), "\\".concat(char));
            }
            return sanitized;
        });
    };
    CommandInjectionPrevention.dangerousCommands = [
        'rm', 'rmdir', 'del', 'format', 'fdisk',
        'cat', 'type', 'more', 'less',
        'wget', 'curl', 'nc', 'netcat',
        'ssh', 'telnet', 'ftp',
        'exec', 'eval', 'system', 'shell_exec',
        'passthru', 'popen', 'proc_open'
    ];
    CommandInjectionPrevention.dangerousChars = ['|', '&', ';', '<', '>', '`', '$', '(', ')', '{', '}', '[', ']'];
    return CommandInjectionPrevention;
}());
exports.CommandInjectionPrevention = CommandInjectionPrevention;
/**
 * XSS Prevention Helper
 */
var XSSPrevention = /** @class */ (function () {
    function XSSPrevention() {
    }
    /**
     * Detect XSS attempts
     */
    XSSPrevention.detectXSS = function (input) {
        var xssPatterns = [
            /<script[^>]*>.*?<\/script>/gi,
            /javascript:/gi,
            /on\w+\s*=/gi,
            /<iframe[^>]*>/gi,
            /<object[^>]*>/gi,
            /<embed[^>]*>/gi,
            /<link[^>]*>/gi,
            /<meta[^>]*>/gi,
            /expression\s*\(/gi,
            /@import/gi,
            /vbscript:/gi
        ];
        for (var _i = 0, xssPatterns_1 = xssPatterns; _i < xssPatterns_1.length; _i++) {
            var pattern = xssPatterns_1[_i];
            if (pattern.test(input)) {
                console.warn('🚨 XSS attempt detected:', input);
                return true;
            }
        }
        return false;
    };
    /**
     * Generate secure content headers
     */
    XSSPrevention.getSecureHeaders = function () {
        return {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
        };
    };
    return XSSPrevention;
}());
exports.XSSPrevention = XSSPrevention;
/**
 * Input Validation Helper
 */
var InputValidation = /** @class */ (function () {
    function InputValidation() {
    }
    /**
     * Validate common input patterns
     */
    InputValidation.validateInput = function (input, type) {
        var patterns = {
            email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            url: /^https?:\/\/.+/,
            numeric: /^\d+$/,
            alphanumeric: /^[a-zA-Z0-9]+$/,
            uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        };
        var pattern = patterns[type];
        if (!pattern) {
            throw new Error("Unknown validation type: ".concat(type));
        }
        return pattern.test(input);
    };
    /**
     * Validate file upload safety
     */
    InputValidation.validateFileUpload = function (filename, mimetype, size) {
        // Check file extension
        var dangerousExtensions = [
            '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar',
            '.php', '.asp', '.aspx', '.jsp', '.sh', '.py', '.rb', '.pl'
        ];
        var extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
        if (dangerousExtensions.includes(extension)) {
            console.warn('🚨 Dangerous file extension detected:', extension);
            return false;
        }
        // Check file size (max 10MB)
        if (size > 10 * 1024 * 1024) {
            console.warn('🚨 File size too large:', size);
            return false;
        }
        // Check MIME type
        var allowedMimeTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'text/plain', 'text/csv', 'application/pdf',
            'application/json', 'application/xml'
        ];
        if (!allowedMimeTypes.includes(mimetype)) {
            console.warn('🚨 Dangerous MIME type detected:', mimetype);
            return false;
        }
        return true;
    };
    return InputValidation;
}());
exports.InputValidation = InputValidation;
/**
 * Security monitoring and alerting
 */
var SecurityMonitor = /** @class */ (function () {
    function SecurityMonitor() {
    }
    /**
     * Log security event
     */
    SecurityMonitor.logEvent = function (type, severity, message, details) {
        var alert = {
            timestamp: new Date(),
            type: type,
            severity: severity,
            message: message,
            details: details
        };
        this.alerts.push(alert);
        // Keep only last 1000 alerts
        if (this.alerts.length > 1000) {
            this.alerts = this.alerts.slice(-1000);
        }
        // Log to console with appropriate level
        var logMessage = "\uD83D\uDD12 ".concat(severity.toUpperCase(), " [").concat(type, "]: ").concat(message);
        switch (severity) {
            case 'critical':
            case 'high':
                console.error(logMessage, details);
                break;
            case 'medium':
                console.warn(logMessage, details);
                break;
            case 'low':
                console.info(logMessage, details);
                break;
        }
    };
    /**
     * Get recent security alerts
     */
    SecurityMonitor.getRecentAlerts = function (hours) {
        if (hours === void 0) { hours = 24; }
        var cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
        return this.alerts.filter(function (alert) { return alert.timestamp > cutoff; });
    };
    /**
     * Check for attack patterns
     */
    SecurityMonitor.detectAttackPattern = function (req) {
        var patterns = [
            { name: 'SQL Injection', check: function (body) { return typeof body === 'string' && /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|EXEC|SCRIPT)\b)/i.test(body); } },
            { name: 'XSS', check: function (body) { return typeof body === 'string' && /<script[^>]*>.*?<\/script>/gi.test(body); } },
            { name: 'Command Injection', check: function (body) { return typeof body === 'string' && CommandInjectionPrevention.detectCommandInjection(body); } },
            { name: 'Path Traversal', check: function (body) { return typeof body === 'string' && /\.\.\//g.test(body); } }
        ];
        for (var _i = 0, patterns_1 = patterns; _i < patterns_1.length; _i++) {
            var pattern = patterns_1[_i];
            if (pattern.check(req.body) || pattern.check(req.query) || pattern.check(req.params)) {
                this.logEvent(pattern.name, 'high', "".concat(pattern.name, " attempt detected"), {
                    ip: req.ip,
                    path: req.path,
                    userAgent: req.get('User-Agent')
                });
                return true;
            }
        }
        return false;
    };
    SecurityMonitor.alerts = [];
    return SecurityMonitor;
}());
exports.SecurityMonitor = SecurityMonitor;
exports.default = SecurityMiddleware;
