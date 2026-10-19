"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = exports.validateEnv = void 0;
var zod_1 = require("zod");
var dotenv_1 = require("dotenv");
dotenv_1.default.config();
var envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    PORT: zod_1.z.coerce.number().default(3001),
    CORS_ALLOWED_ORIGINS: zod_1.z.string().default('*'),
    STELLAR_NETWORK: zod_1.z.enum(['testnet', 'public']).default('testnet'),
    OPENAI_API_KEY: zod_1.z.string({
        required_error: 'OPENAI_API_KEY is required for verification and invoicing services',
    }).min(1, 'OPENAI_API_KEY cannot be empty'),
    JOBS_ENABLED: zod_1.z.coerce.string().transform(function (val) { return val !== 'false'; }).default('true'),
    QUEUE_ENABLED: zod_1.z.coerce.string().transform(function (val) { return val !== 'false'; }).default('true'),
    RATE_LIMIT_FREE: zod_1.z.coerce.number().default(100),
    RATE_LIMIT_PRO: zod_1.z.coerce.number().default(300),
    RATE_LIMIT_ENTERPRISE: zod_1.z.coerce.number().default(1000),
    RATE_LIMIT_WINDOW_MS: zod_1.z.coerce.number().default(15 * 60 * 1000),
    IP_ALLOWLIST: zod_1.z.string().default(''),
    IP_ALLOWLIST_ENABLED: zod_1.z.coerce.string().transform(function (val) { return val === 'true'; }).default('false'),
    IP_ALLOWLIST_BYPASS_ENABLED: zod_1.z.coerce.string().transform(function (val) { return val === 'true'; }).default('false'),
    IP_ALLOWLIST_BYPASS_EXPIRY_MS: zod_1.z.coerce.number().default(30 * 60 * 1000),
    VAPID_PUBLIC_KEY: zod_1.z.string().default(''),
    VAPID_PRIVATE_KEY: zod_1.z.string().default(''),
    STRIPE_SECRET_KEY: zod_1.z.string().default(''),
    STRIPE_WEBHOOK_SECRET: zod_1.z.string().default(''),
    STRIPE_PUBLISHABLE_KEY: zod_1.z.string().default(''),
});
var _config;
var validateEnv = function () {
    try {
        _config = envSchema.parse(process.env);
        return _config;
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            var missingVars = error.errors.map(function (err) { return "".concat(err.path.join('.'), ": ").concat(err.message); });
            console.error('❌ Invalid environment variables:');
            missingVars.forEach(function (msg) { return console.error("   - ".concat(msg)); });
            process.exit(1);
        }
        throw error;
    }
};
exports.validateEnv = validateEnv;
var config = function () {
    if (!_config) {
        return (0, exports.validateEnv)();
    }
    return _config;
};
exports.config = config;
