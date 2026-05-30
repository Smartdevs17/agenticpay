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
import { tokenBucketRateLimit } from './middleware/rate-limit.js';
import { compressionMiddleware, getCompressionMetrics } from './middleware/compression.js';
import { poolMetrics } from './config/database.js';
import { config } from './config.js';
import { verificationRouter } from './routes/verification.js';
import { invoiceRouter } from './routes/invoice.js';
import { stellarRouter } from './routes/stellar.js';
import { catalogRouter } from './routes/catalog.js';
import { jobsRouter } from './routes/jobs.js';
import { healthRouter } from './routes/health.js';
import { docsRouter } from './routes/docs.js';
import { queueRouter } from './routes/queue.js';
import { slaRouter } from './routes/sla.js';
import { legacyRouter } from './routes/legacy.js';
import { onboardingRouter } from './routes/onboarding.js';
import { splitsRouter } from './routes/splits.js';
import { refundsRouter } from './routes/refunds.js';
import allowancesRouter from './routes/allowances.js';
import { formsRouter } from './routes/forms.ts';
import { webhooksRouter } from './routes/webhooks.js';
import { webhookHandlersRouter } from './routes/webhookHandlers.js';
import { startJobs, getJobScheduler } from './jobs/index.js';
import { batchProcessor } from './services/batch.js';
import { featureFlags } from './config/featureFlags.js';
import { getRedisCache } from './middleware/cache.js';
import { errorHandler, notFoundHandler, AppError } from './middleware/errorHandler.js';
import { messageQueue } from './services/queue.js';
import { registerDefaultProcessors } from './services/queue-producers.js';
import { slaTrackingMiddleware } from './middleware/slaTracking.js';
import { requestIdMiddleware, REQUEST_ID_HEADER } from './middleware/requestId.js';
import { httpLogger, correlationMiddleware } from './middleware/logger.js';
import { validateEnv, config as getConfig } from './config/env.js';
import { flagsRouter } from './routes/flags.js';
import { rateLimitAnalyticsRouter } from './routes/rate-limit-analytics.js';
import { emailRouter } from './routes/email.js';
import { portfolioRouter } from './routes/portfolio.js';
import { backupRouter } from './routes/backup.js';
import { pushRouter } from './routes/push.js';
import { ipAllowlistRouter } from './routes/ip-allowlist.js';
import { nfcRouter } from './routes/nfc.js';
import { cacheRouter } from './routes/cache.js';
import { ipAllowlistMiddleware, initIpAllowlist } from './middleware/ip-allowlist.js';
import { sessionsRouter } from './routes/sessions.js';
import { sessionMiddleware } from './middleware/session.js';
import { notificationsRouter } from './routes/notifications.js';
import { auditRouter } from './routes/audit.js';
import { hedgingRouter } from './routes/hedging.js';
import { complianceRouter } from './routes/compliance.js';
import { kybRouter } from './routes/kyb.js';
import { batchRouter } from './routes/batch.js';
import { relayerRouter } from './routes/relayer.js';
import { paymentQueueRouter } from './routes/payment-queue.js';
import { disputeRoutes } from './disputes/index.js';
import { disputeService } from './disputes/disputeService.js';
import http from 'node:http';
import { attachWebSocketServer } from './websocket/server.js';
import { createWebSocketRouter } from './routes/websocket.js';
import { bindWebSocketServer } from './events/event-bus.js';
import { receiptsRouter } from './routes/receipts.js';
import { eventsRouter } from './routes/events.js';
import { threatDetectionRouter } from './routes/threat-detection.js';
import { serviceMeshRouter } from './routes/service-mesh.js';
import { escrowRouter } from './routes/escrow.js';
import { multisigRouter } from './routes/multisig.js';
import { fiatPaymentsRouter } from './routes/fiat-payments.js';
import { paymentLinksRouter } from './routes/payment-links.js';
import { taxRouter } from './routes/tax.js';
import { projectsRouter } from './routes/projects.js';
import { graphQLRouter, graphQLWsRouter } from './graphql/gateway.js';
import { fraudDetectionRouter } from './routes/fraud-detection.js';
import { bridgeRouter } from './routes/bridge.js';
import { tokenizationRouter } from './routes/tokenization.js';
import { startWebhookWorker, stopWebhookWorker } from './services/webhooks.js';
import { analyticsService } from './services/analytics.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { paymentQueue } from './queue/payment-queue.js';
import './events/projections.js';
import { stripeRouter } from './routes/stripe.js';
import { SecurityMiddleware, SecurityMonitor } from './middleware/security.js';
import { sanitizeInput, contentSecurityPolicy } from './middleware/sanitize.js';
import { requestSizeLimit } from './middleware/request-size-limit.js';
import { signaturesRouter } from './routes/signatures.js';
import { createSandboxRouter } from './routes/sandbox.js';
import { circuitBreakerRouter } from './routes/circuit-breaker.js';
import SandboxManager from './services/sandbox.js';
import MockPaymentProcessor from './services/mock-payments.js';
import TestDataSeeder from './services/test-data-seeder.js';
import { emailV2Router } from './routes/email-v2.js';
import { createBullMQScheduler, getBullMQScheduler } from './services/bullmq-scheduler.js';
import { getScheduledTasks } from './config/scheduled-tasks.js';
import { bullMQMonitorRouter } from './routes/bullmq-monitor.js';
import { fileUploadRouter } from './routes/file-upload.js';
import { credentialRotationRouter } from './routes/credential-rotation.js';
import zkIdentityRouter from './routes/zk-identity.js';

// Validate environment variables at startup
validateEnv();
const env = getConfig();

// Initialize sandbox services
const sandboxManager = new SandboxManager(env.NODE_ENV || 'development');
const mockPaymentProcessor = new MockPaymentProcessor();
const testDataSeeder = new TestDataSeeder();

// Initialize IP allowlist from environment
if (env.IP_ALLOWLIST_ENABLED || env.IP_ALLOWLIST) {
  const allowedIps = env.IP_ALLOWLIST ? env.IP_ALLOWLIST.split(',').map(ip => ip.trim()).filter(Boolean) : [];
  initIpAllowlist(allowedIps, env.IP_ALLOWLIST_ENABLED);
  console.log(`[IP Allowlist] Enabled with ${allowedIps.length} IP(s)`);
}

const app = express();

// Security stack: headers, sanitization, payload limits
SecurityMiddleware.getInstance().applySecurity(app);
app.use(requestSizeLimit());

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
      'Stripe-Signature',
      'X-Hub-Signature-256',
      'X-Webhook-Key-Id',
    ],
  })
);

app.use(requestIdMiddleware);
app.use(correlationMiddleware);
app.use(httpLogger);

// Incoming webhooks: raw body capture before global JSON parser (#393)
app.use('/webhooks', webhookHandlersRouter);

app.use(express.json());
app.use(express.text({ type: ['text/csv', 'text/plain'] }));

app.use(
  compressionMiddleware({
    brotliLevel: 5,
    gzipLevel: 6,
    minSizeBytes: 1024,
  })
);

app.use(slaTrackingMiddleware);
app.use(sessionMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.setHeader('Vary', 'Accept-Encoding');
  next();
});

app.use(healthRouter);
app.use('/docs', docsRouter);

import { versionMiddleware } from './middleware/versioning.js';

app.use('/api/', apiRateLimiter);

// Apply sandbox-aware rate limiting for sandbox endpoints
const sandboxRateLimiter = tokenBucketRateLimit({ 
  keyPrefix: 'rl:sandbox',
  sandboxMode: env.NODE_ENV === 'sandbox' || env.NODE_ENV === 'development'
});

app.use('/api/', versionMiddleware);

const apiV1Router = express.Router();
apiV1Router.use('/verification', verificationRouter);
apiV1Router.use('/invoice', invoiceLimiter, invoiceRouter);
apiV1Router.use('/stellar', stellarRouter);
apiV1Router.use('/catalog', catalogRouter);
apiV1Router.use('/jobs', jobsRouter);
apiV1Router.use('/queue', queueRouter);
apiV1Router.use('/queue', bullMQMonitorRouter);
apiV1Router.use('/sla', slaRouter);
apiV1Router.use('/onboarding', onboardingRouter);
apiV1Router.use('/legacy', legacyRouter);
apiV1Router.use('/flags', flagsRouter);
apiV1Router.use('/rate-limit', rateLimitAnalyticsRouter);
apiV1Router.use('/zk-identity', zkIdentityRouter);
apiV1Router.use('/kyb', kybRouter);
apiV1Router.use('/batch', batchRouter);
apiV1Router.use('/relayer', relayerRouter);
apiV1Router.use('/queue/payments', paymentQueueRouter);
apiV1Router.use('/splits', splitsRouter);
apiV1Router.use('/refunds', refundsRouter);
apiV1Router.use('/allowances', allowancesRouter);
apiV1Router.use('/forms', formsRouter);
// Webhook management and verification
apiV1Router.use('/webhooks', webhooksRouter);
// Email delivery system
apiV1Router.use('/disputes', disputeRoutes);
apiV1Router.use('/emails', emailRouter);
apiV1Router.use('/portfolio', portfolioRouter);
apiV1Router.use('/backup', backupRouter);
apiV1Router.use('/ip-allowlist', ipAllowlistRouter);
apiV1Router.use('/push', pushRouter);
// NFC / QR payment requests
apiV1Router.use('/nfc', nfcRouter);
// Cache management
apiV1Router.use('/cache', cacheRouter);

apiV1Router.use('/circuit-breaker', circuitBreakerRouter);
apiV1Router.get('/compression/metrics', (_req, res) => {
  res.json(getCompressionMetrics());
});
apiV1Router.get('/pool/metrics', (_req, res) => {
  res.json(poolMetrics.snapshot());
});

app.use('/api/v1', ipAllowlistMiddleware(), apiV1Router);

app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/audit', auditRouter);
app.use('/api/v1/hedging', hedgingRouter);
app.use('/api/v1/compliance', complianceRouter);
app.use('/api/v1/gdpr', gdprRouter);
app.use('/api/v1/escrow', escrowRouter);
app.use('/api/v1/multisig', multisigRouter);
app.use('/api/v1/webhooks', webhooksRouter);
app.use('/api/v1/fraud-detection', fraudDetectionRouter);
app.use('/api/v1/bridge', bridgeRouter);
app.use('/api/v1/tokenization', tokenizationRouter);

// Payment receipt NFTs
app.use('/api/v1/receipts', receiptsRouter);

// Event-driven architecture — event store, CQRS projections
app.use('/api/v1/events', eventsRouter);

// Advanced threat detection with behavioral analysis
app.use('/api/v1/threat-detection', threatDetectionRouter);

// Secure file upload with MIME/magic-bytes validation and ClamAV scanning (Issue #401)
app.use('/api/v1/uploads', fileUploadRouter);

// Credential rotation management with dual-key overlap and audit trail (Issue #395)
app.use('/api/v1/credentials', credentialRotationRouter);

// Microservices service mesh — registry, discovery, circuit breakers
app.use('/api/v1/service-mesh', serviceMeshRouter);

// Fiat ACH/Wire payment approval workflows
app.use('/api/v1/fiat-payments', fiatPaymentsRouter);

// Merchant dynamic payment links
app.use('/api/v1/payment-links', paymentLinksRouter);

// Merchant tax report generation (summary, 1099-K, VAT, nexus, CSV export)
app.use('/api/v1/tax', taxRouter);

// Project + milestone delivery approval workflow
app.use('/api/v1/projects', projectsRouter);

// Sandbox environment for testing (with relaxed rate limits)
const sandboxRouter = createSandboxRouter(sandboxManager, mockPaymentProcessor, testDataSeeder);
app.use('/api/v1/sandbox', sandboxRateLimiter, sandboxRouter);

// Email system v2 with templates, analytics, and localization
app.use('/api/v2/email', emailV2Router);

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

  // Start the BullMQ distributed scheduler when Redis is available.
  // Falls back silently to the in-process node-cron scheduler if Redis is absent.
  createBullMQScheduler(getScheduledTasks()).then((scheduler) => {
    if (scheduler) {
      console.log('[bullmq] Distributed scheduler active');
    } else {
      console.log('[scheduler] Using in-process node-cron (Redis not configured)');
    }
  }).catch((err) => {
    console.error('[bullmq] Scheduler startup error:', err);
  });
}

// Start automated credential rotation scheduler (Issue #395)
startScheduledRotation();
console.log('[CredentialRotation] Scheduled rotation started');

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

if (featureFlags.evaluate('batch-operations')) {
  batchProcessor.start();
  console.log('[BatchProcessor] Started');
}

getRedisCache().connect().then(() => {
  console.log('[RedisCache] Connection initialized');
}).catch(() => {
  console.log('[RedisCache] Not available, using in-memory cache only');
});

const server = http.createServer(app);
const wsServer = attachWebSocketServer({ server, options: { path: '/ws' } });
bindWebSocketServer(wsServer);
app.use('/api/v1/websocket', createWebSocketRouter(wsServer));
app.use('/api/v1/analytics', createAnalyticsRouter(wsServer));

const analyticsInterval = setInterval(() => {
  wsServer.broadcastToChannel('analytics.updates', { type: 'analytics:update', payload: analyticsService.snapshot() });
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
      const bullScheduler = getBullMQScheduler();
      if (bullScheduler) {
        bullScheduler.shutdown().then(() => console.log('BullMQ scheduler stopped.'));
      }
    } catch (err) {
      console.error('Error stopping BullMQ scheduler:', err);
    }

    try {
      stopScheduledRotation();
      console.log('Credential rotation scheduler stopped.');
    } catch (err) {
      console.error('Error stopping credential rotation:', err);
    }

    try {
      messageQueue.stop();
      paymentQueue.stop();
      stopWebhookWorker();
      console.log('Message queue stopped.');
    } catch (err) {
      console.error('Error stopping message queue:', err);
    }

    try {
      batchProcessor.stop();
      console.log('Batch processor stopped.');
    } catch (err) {
      console.error('Error stopping batch processor:', err);
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
