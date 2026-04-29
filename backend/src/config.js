"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
var dotenv_1 = require("dotenv");
var zod_1 = require("zod");
dotenv_1.default.config();
var envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'staging', 'production']).default('development'),
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
    VAPID_PUBLIC_KEY: zod_1.z.string().default(''),
    VAPID_PRIVATE_KEY: zod_1.z.string().default(''),
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
    vapidKeys: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
        : null,
};
