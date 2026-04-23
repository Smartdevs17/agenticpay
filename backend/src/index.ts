import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { config } from './config.js';
import { verificationRouter } from './routes/verification.js';
import { invoiceRouter } from './routes/invoice.js';
import { stellarRouter } from './routes/stellar.js';
import { catalogRouter } from './routes/catalog.js';
import { jobsRouter } from './routes/jobs.js';
import { healthRouter } from './routes/health.js';
import { queueRouter } from './routes/queue.js';
import { slaRouter } from './routes/sla.js';
import { legacyRouter } from './routes/legacy.js';
import { splitsRouter } from './routes/splits.js';
import { refundsRouter } from './routes/refunds.js';
import { startJobs, getJobScheduler } from './jobs/index.js';
import { errorHandler, notFoundHandler, AppError } from './middleware/errorHandler.js';
import { messageQueue } from './services/queue.js';
import { registerDefaultProcessors } from './services/queue-producers.js';
import { slaTrackingMiddleware } from './middleware/slaTracking.js';
import { requestIdMiddleware, REQUEST_ID_HEADER } from './middleware/requestId.js';
import { validateEnv, config as getConfig } from './config/env.js';
import { flagsRouter } from './routes/flags.js';
import { emailRouter } from './routes/email.js';
import { portfolioRouter } from './routes/portfolio.js';
import { backupRouter } from './routes/backup.js';
import { ipAllowlistRouter } from './routes/ip-allowlist.js';
import { ipAllowlistMiddleware, initIpAllowlist } from './middleware/ip-allowlist.js';

// Validate environment variables at startup
validateEnv();
const env = getConfig();

// Initialize IP allowlist from environment
if (env.IP_ALLOWLIST_ENABLED || env.IP_ALLOWLIST) {
  const allowedIps = env.IP_ALLOWLIST ? env.IP_ALLOWLIST.split(',').map(ip => ip.trim()).filter(Boolean) : [];
  initIpAllowlist(allowedIps, env.IP_ALLOWLIST_ENABLED);
  console.log(`[IP Allowlist] Enabled with ${allowedIps.length} IP(s)`);
}

const traceStorage = new AsyncLocalStorage<string>();

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function formatMessage(args: any[]): any[] {
  const traceId = traceStorage.getStore();
  if (traceId) {
    if (typeof args[0] === 'string') {
      args[0] = `[TraceID: ${traceId}] ${args[0]}`;
    } else {
      args.unshift(`[TraceID: ${traceId}]`);
    }
  }
  return args;
}

console.log = (...args) => originalConsole.log(...formatMessage(args));
console.info = (...args) => originalConsole.info(...formatMessage(args));
console.warn = (...args) => originalConsole.warn(...formatMessage(args));
console.error = (...args) => originalConsole.error(...formatMessage(args));

const app = express();

type UserTier = 'free' | 'pro' | 'enterprise';

type TierRateState = {
  count: number;
  resetAtMs: number;
};

const tierLimits: Record<UserTier, number> = {
  free: config.rateLimit.free,
  pro: config.rateLimit.pro,
  enterprise: config.rateLimit.enterprise,
};

const tierWindowMs = config.rateLimit.windowMs;
const tierRateStore = new Map<string, TierRateState>();

function resolveUserTier(req: Request): UserTier {
  const headerTier = req.headers['x-user-tier'];
  const normalized = (Array.isArray(headerTier) ? headerTier[0] : headerTier)?.toLowerCase();

  if (normalized === 'pro' || normalized === 'enterprise') {
    return normalized;
  }

  return 'free';
}

function resolveClientIdentifier(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    return authHeader;
  }

  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim() !== '') {
    return apiKey;
  }

  return req.ip || 'unknown-client';
}

function tieredRateLimit(req: Request, res: Response, next: NextFunction): void {
  const tier = resolveUserTier(req);
  const limit = tierLimits[tier];
  const identifier = resolveClientIdentifier(req);
  const storeKey = `${tier}:${identifier}`;
  const nowMs = Date.now();
  const existingState = tierRateStore.get(storeKey);

  const state =
    !existingState || existingState.resetAtMs <= nowMs
      ? { count: 0, resetAtMs: nowMs + tierWindowMs }
      : existingState;

  state.count += 1;
  tierRateStore.set(storeKey, state);

  const remaining = Math.max(0, limit - state.count);
  const resetInSeconds = Math.ceil((state.resetAtMs - nowMs) / 1000);

  res.setHeader('X-RateLimit-Tier', tier);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(resetInSeconds));

  if (state.count > limit) {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded for tier '${tier}'`,
        status: 429,
      },
    });
    return;
  }

  next();
}

const invoiceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(
  cors({
    origin: config.cors.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id', REQUEST_ID_HEADER],
  })
);
app.use(express.json());

app.use(
  compression({
    threshold: config.compression.threshold,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      const contentType = res.getHeader('Content-Type');
      if (typeof contentType === 'string' && contentType.includes('application/json')) {
        return true;
      }
      if (Array.isArray(contentType) && contentType.some((ct) => ct.includes('application/json'))) {
        return true;
      }
      return compression.filter(req, res);
    },
  })
);

app.use(requestIdMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  const traceId = (req.headers['x-trace-id'] as string) || randomUUID();
  res.setHeader('X-Trace-Id', traceId);

  traceStorage.run(traceId, () => {
    console.log(`${req.method} ${req.url} [RequestID: ${req.requestId}] - Started`);

    res.on('finish', () => {
      console.log(`${req.method} ${req.url} [RequestID: ${req.requestId}] - Finished with status ${res.statusCode}`);
    });

    next();
  });
});

app.use(slaTrackingMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.setHeader('Vary', 'Accept-Encoding');
  next();
});

app.use(healthRouter);

import { versionMiddleware } from './middleware/versioning.js';

app.use('/api/', tieredRateLimit);

app.use('/api/', versionMiddleware);

const apiV1Router = express.Router();
apiV1Router.use('/verification', verificationRouter);
apiV1Router.use('/invoice', invoiceLimiter, invoiceRouter);
apiV1Router.use('/stellar', stellarRouter);
apiV1Router.use('/catalog', catalogRouter);
apiV1Router.use('/jobs', jobsRouter);
apiV1Router.use('/queue', queueRouter);
apiV1Router.use('/sla', slaRouter);
apiV1Router.use('/legacy', legacyRouter);
apiV1Router.use('/splits', splitsRouter);
apiV1Router.use('/refunds', refundsRouter);
// Email delivery system
apiV1Router.use('/emails', emailRouter);
// Portfolio/wallet aggregation
apiV1Router.use('/portfolio', portfolioRouter);
// Backup system
apiV1Router.use('/backup', backupRouter);
// IP allowlist management
apiV1Router.use('/ip-allowlist', ipAllowlistRouter);

app.use('/api/v1', ipAllowlistMiddleware(), apiV1Router);

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/v1/')) {
    return next();
  }

  if (req.apiVersion === 'v1') {
    return apiV1Router(req, res, next);
  }

  next(new AppError(404, `API Version ${req.apiVersion} is not supported`, 'UNSUPPORTED_API_VERSION'));
});

app.use(notFoundHandler);
app.use(errorHandler);

if (config.jobs.enabled) {
  startJobs();
}

registerDefaultProcessors();
if (config.queue.enabled) {
  messageQueue.start();
}

const server = app.listen(config.server.port, () => {
  console.log(`AgenticPay backend running on port ${config.server.port} [${config.env}]`);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received. Starting graceful shutdown...`);

  server.close(() => {
    console.log('HTTP server closed.');

    try {
      const scheduler = getJobScheduler();
      if (scheduler) {
        scheduler.stopAll();
        console.log('Job scheduler stopped.');
      }
    } catch (err) {
      console.error('Error stopping scheduler:', err);
    }

    try {
      messageQueue.stop();
      console.log('Message queue stopped.');
    } catch (err) {
      console.error('Error stopping message queue:', err);
    }

    console.log('Graceful shutdown complete. Exiting.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Could not close connections in time, forceful shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
