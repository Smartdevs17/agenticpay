"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
var dotenv_1 = require("dotenv");
var zod_1 = require("zod");
if (dotenv_1.default && dotenv_1.default.config) {
    dotenv_1.default.config();
} else if (dotenv_1.config) {
    dotenv_1.config();
}
var envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'staging', 'production', 'test']).default('development'),
    PORT: zod_1.z.string().default('3001'),
    CORS_ALLOWED_ORIGINS: zod_1.z.string().default('*'),
    JOBS_ENABLED: zod_1.z.enum(['true', 'false']).default('true'),
    QUEUE_ENABLED: zod_1.z.enum(['true', 'false']).default('true'),
    STELLAR_NETWORK: zod_1.z.enum(['testnet', 'public']).default('testnet'),
    RATE_LIMIT_FREE: zod_1.z.string().default('100'),
    RATE_LIMIT_PRO: zod_1.z.string().default('300'),
    RATE_LIMIT_ENTERPRISE: zod_1.z.string().default('1000'),
    RATE_LIMIT_WINDOW_MS: zod_1.z.string().default(String(15 * 60 * 1000)),
    COMPRESSION_THRESHOLD: zod_1.z.string().default('1024'),
    DATABASE_URL: zod_1.z.string().default('postgresql://postgres:postgres@localhost:5432/agenticpay'),
    PGBOUNCER_ENABLED: zod_1.z.enum(['true', 'false']).default('false'),
    DB_POOL_MIN: zod_1.z.string().default('2'),
    DB_POOL_MAX: zod_1.z.string().default('10'),
    DB_POOL_IDLE_TIMEOUT_MS: zod_1.z.string().default('10000'),
    DB_POOL_ACQUIRE_TIMEOUT_MS: zod_1.z.string().default('30000'),
    DB_POOL_MAX_USES: zod_1.z.string().default('7500'),
    DB_STATEMENT_TIMEOUT_MS: zod_1.z.string().default('30000'),
});
var parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    process.exit(1);
}
var env = parsed.data;
exports.config = {
    env: env.NODE_ENV,
    isDev: env.NODE_ENV === 'development',
    isStaging: env.NODE_ENV === 'staging',
    isProd: env.NODE_ENV === 'production',
    server: {
        port: Number(env.PORT),
    },
    cors: {
        allowedOrigins: env.CORS_ALLOWED_ORIGINS.split(',').map(function (o) { return o.trim(); }),
    },
    jobs: {
        enabled: env.JOBS_ENABLED === 'true',
    },
    queue: {
        enabled: env.QUEUE_ENABLED === 'true',
    },
    stellar: {
        network: env.STELLAR_NETWORK,
    },
    rateLimit: {
        free: Number(env.RATE_LIMIT_FREE),
        pro: Number(env.RATE_LIMIT_PRO),
        enterprise: Number(env.RATE_LIMIT_ENTERPRISE),
        windowMs: Number(env.RATE_LIMIT_WINDOW_MS),
    },
    compression: {
        threshold: Number(env.COMPRESSION_THRESHOLD),
    },
    db: {
        url: env.DATABASE_URL,
        pgbouncer: {
            enabled: env.PGBOUNCER_ENABLED === 'true',
        },
        pool: {
            min: Number(env.DB_POOL_MIN),
            max: Number(env.DB_POOL_MAX),
            idleTimeoutMs: Number(env.DB_POOL_IDLE_TIMEOUT_MS),
            acquireTimeoutMs: Number(env.DB_POOL_ACQUIRE_TIMEOUT_MS),
            maxUses: Number(env.DB_POOL_MAX_USES),
            statementTimeoutMs: Number(env.DB_STATEMENT_TIMEOUT_MS),
        },
    },
    vapidKeys: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
        : null,
};
