import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import express, { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
  environment: process.env.NODE_ENV || 'development',
  beforeSend(event, hint) {
    if (event.exception && hint.originalException) {
      const error = hint.originalException as Error;
      if (error && error.message && error.message.includes('Database connection timeout')) {
        event.fingerprint = ['database-timeout'];
      }
    }
    return event;
  }
});
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { tokenBucketRateLimit } from './middleware/rate-limit.js';
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
import { onboardingRouter } from './routes/onboarding.js';
import { splitsRouter } from './routes/splits.js';
import { refundsRouter } from './routes/refunds.js';
import { allowancesRouter } from './routes/allowances.js';
import { formsRouter } from './routes/forms.js';
import { startJobs, getJobScheduler } from './jobs/index.js';
import { errorHandler, notFoundHandler, AppError } from './middleware/errorHandler.js';
import { messageQueue } from './services/queue.js';
import { registerDefaultProcessors } from './services/queue-producers.js';
import { slaTrackingMiddleware } from './middleware/slaTracking.js';
import { requestIdMiddleware, REQUEST_ID_HEADER } from './middleware/requestId.js';
import { validateEnv, config as getConfig } from './config/env.js';
import { flagsRouter } from './routes/flags.js';
import { rateLimitAnalyticsRouter } from './routes/rate-limit-analytics.js';
import { emailRouter } from './routes/email.js';
import { portfolioRouter } from './routes/portfolio.js';
import { backupRouter } from './routes/backup.js';
import { pushRouter } from './routes/push.js';
import { ipAllowlistRouter } from './routes/ip-allowlist.js';
import { gdprRouter } from './routes/gdpr.js';
import { ipAllowlistMiddleware, initIpAllowlist } from './middleware/ip-allowlist.js';
import { notificationsRouter } from './routes/notifications.js';
import { auditRouter } from './routes/audit.js';
import { hedgingRouter } from './routes/hedging.js';
import { complianceRouter } from './routes/compliance.js';
import { disputeRoutes } from './disputes/index.js';
import { disputeService } from './disputes/disputeService.js';
import http from 'node:http';
import { attachWebSocketServer } from './websocket/server.js';
import { createWebSocketRouter } from './routes/websocket.js';
import { complianceRouter } from './routes/compliance.js';
import { receiptsRouter } from './routes/receipts.js';
import { eventsRouter } from './routes/events.js';
import { threatDetectionRouter } from './routes/threat-detection.js';
import { serviceMeshRouter } from './routes/service-mesh.js';
import { escrowRouter } from './routes/escrow.js';
import { multisigRouter } from './routes/multisig.js';
import { fiatPaymentsRouter } from './routes/fiat-payments.js';
import { paymentLinksRouter } from './routes/payment-links.js';
import { projectsRouter } from './routes/projects.js';
import { graphQLRouter, graphQLWsRouter } from './graphql/gateway.js';
import { webhooksRouter } from './routes/webhooks.js';
import { fraudDetectionRouter } from './routes/fraud-detection.js';
import { bridgeRouter } from './routes/bridge.js';
import { tokenizationRouter } from './routes/tokenization.js';
import { startWebhookWorker, stopWebhookWorker } from './services/webhooks.js';
import { analyticsService } from './services/analytics.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import './events/projections.js';

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

// Token-bucket rate limiter (replaces fixed-window tieredRateLimit)
const apiRateLimiter = tokenBucketRateLimit({ keyPrefix: 'rl:api' });
// Stricter limiter for invoice endpoint
const invoiceLimiter = tokenBucketRateLimit({
  keyPrefix: 'rl:invoice',
  endpointConfig: {
    free:       { capacity: 10,  refillRate: 0.1, burstAllowance: 2  },
    pro:        { capacity: 60,  refillRate: 1,   burstAllowance: 10 },
    enterprise: { capacity: 300, refillRate: 5,   burstAllowance: 50 },
  },
});

app.use(
  cors({
    origin: config.cors.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Trace-Id',
      REQUEST_ID_HEADER,
      'API-Version',
      'X-API-Version',
      'Accept-Version',
    ],
  })
);
app.use(express.json());
app.use(express.text({ type: ['text/csv', 'text/plain'] }));

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

app.use('/api/', apiRateLimiter);

app.use('/api/', versionMiddleware);

const apiV1Router = express.Router();
apiV1Router.use('/verification', verificationRouter);
apiV1Router.use('/invoice', invoiceLimiter, invoiceRouter);
apiV1Router.use('/stellar', stellarRouter);
apiV1Router.use('/catalog', catalogRouter);
apiV1Router.use('/jobs', jobsRouter);
apiV1Router.use('/queue', queueRouter);
apiV1Router.use('/sla', slaRouter);
apiV1Router.use('/onboarding', onboardingRouter);
apiV1Router.use('/legacy', legacyRouter);
apiV1Router.use('/flags', flagsRouter);
apiV1Router.use('/kyb', kybRouter);
apiV1Router.use('/batch', batchRouter);
apiV1Router.use('/relayer', relayerRouter);
apiV1Router.use('/queue/payments', paymentQueueRouter);
apiV1Router.use('/splits', splitsRouter);
apiV1Router.use('/refunds', refundsRouter);
apiV1Router.use('/allowances', allowancesRouter);
apiV1Router.use('/forms', formsRouter);
apiV1Router.use('/disputes', disputeRoutes);
apiV1Router.use('/emails', emailRouter);
apiV1Router.use('/portfolio', portfolioRouter);
apiV1Router.use('/backup', backupRouter);
apiV1Router.use('/ip-allowlist', ipAllowlistRouter);
apiV1Router.use('/push', pushRouter);
// Rate limit analytics
apiV1Router.use('/rate-limit', rateLimitAnalyticsRouter);

app.use('/api/v1', ipAllowlistMiddleware(), apiV1Router);

app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/audit', auditRouter);
app.use('/api/v1/hedging', hedgingRouter);
app.use('/api/v1/compliance', complianceRouter);

// Payment receipt NFTs
app.use('/api/v1/receipts', receiptsRouter);

// Event-driven architecture — event store, CQRS projections
app.use('/api/v1/events', eventsRouter);

// Advanced threat detection with behavioral analysis
app.use('/api/v1/threat-detection', threatDetectionRouter);

// Microservices service mesh — registry, discovery, circuit breakers
app.use('/api/v1/service-mesh', serviceMeshRouter);

// Fiat ACH/Wire payment approval workflows
app.use('/api/v1/fiat-payments', fiatPaymentsRouter);

// Merchant dynamic payment links
app.use('/api/v1/payment-links', paymentLinksRouter);

// Project + milestone delivery approval workflow
app.use('/api/v1/projects', projectsRouter);

// GraphQL gateway with federation-ready schema and subscriptions stream
app.use('/graphql', graphQLRouter);
app.use('/graphql/ws', graphQLWsRouter);

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

Sentry.setupExpressErrorHandler(app);

app.use(errorHandler);

if (config.jobs.enabled) {
  startJobs();
}

registerDefaultProcessors();
if (config.queue.enabled) {
  messageQueue.start();
  paymentQueue.start();
}
startWebhookWorker();

// Auto-escalation cron
setInterval(async () => {
  const count = await disputeService.processEscalations();
  if (count > 0) console.log(`Escalated ${count} disputes`);
}, 5 * 60 * 1000);

const server = http.createServer(app);
const wsServer = attachWebSocketServer({ server, options: { path: '/ws' } });
app.use('/api/v1/websocket', createWebSocketRouter(wsServer));
app.use('/api/v1/analytics', createAnalyticsRouter(wsServer));

// Broadcast analytics snapshot every 30 seconds to all connected WebSocket clients
const analyticsInterval = setInterval(() => {
  wsServer.broadcast({ type: 'analytics:update', payload: analyticsService.snapshot() });
}, 30_000);

server.listen(config.server.port, () => {
  console.log(`AgenticPay backend running on port ${config.server.port} [${config.env}]`);
  console.log(`WebSocket server listening on path /ws (max ${wsServer.metrics.activeConnections}/${wsServer.metrics.acceptedConnections})`);
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
      paymentQueue.stop();
      stopWebhookWorker();
      console.log('Message queue stopped.');
    } catch (err) {
      console.error('Error stopping message queue:', err);
    }

    clearInterval(analyticsInterval);

    try {
      wsServer.close().then(() => console.log('WebSocket server closed.'));
    } catch (err) {
      console.error('Error closing WebSocket server:', err);
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