/**
 * Self-contained Express app for benchmarks (no Prisma, Stellar, or job scheduler).
 */
import express from 'express';
import { etag } from '../../middleware/etag.js';
import { cacheControl } from '../../middleware/cache.js';
import { createCorsMiddleware } from '../../middleware/cors.js';
import { WebhookKeyRegistry } from '../../services/webhookKeys.js';

const escrows: Array<Record<string, unknown>> = [];
const payments = new Map<string, Record<string, unknown>>();

export function createBenchmarkApp(): express.Application {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      service: 'agenticpay-backend-benchmark',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', (_req, res) => {
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  });

  const api = express.Router();

  api.get('/flags', (_req, res) => {
    res.json({ flags: { benchmark: true } });
  });

  api.get('/escrow', (_req, res) => {
    res.json(escrows);
  });

  api.post('/escrow', (req, res) => {
    const escrow = { id: `esc_${Date.now()}`, ...req.body, status: 'pending' };
    escrows.push(escrow);
    res.status(201).json(escrow);
  });

  api.get('/circuit-breaker', (_req, res) => {
    res.json({ circuits: [], status: 'closed' });
  });

  api.get('/compression/metrics', (_req, res) => {
    res.json({ enabled: true, ratio: 0.72 });
  });

  api.get('/pool/metrics', (_req, res) => {
    res.json({ active: 0, idle: 2, waiting: 0 });
  });

  api.get('/sandbox/status', (_req, res) => {
    res.json({ sandbox: true, environment: 'benchmark', timestamp: Date.now() });
  });

  api.post('/sandbox/payments/process', (req, res) => {
    const txnId = `txn_${Date.now()}`;
    const payment = {
      transactionId: txnId,
      status: 'success',
      ...req.body,
      timestamp: Date.now(),
    };
    payments.set(txnId, payment);
    res.json({ success: true, payment });
  });

  // ── Response caching benchmarks ──────────────────────────────────────────
  // Same logical body for every cache strategy so timings are comparable.
  api.get('/cache/plain', (_req, res) => {
    res.json({ cache: 'none', timestamp: Date.now() });
  });

  api.get(
    '/cache/header',
    cacheControl({ maxAge: 300 }),
    (_req, res) => {
      res.json({ cache: 'header', timestamp: Date.now() });
    },
  );

  api.get(
    '/cache/memory',
    cacheControl({ maxAge: 300, inMemory: true }),
    (_req, res) => {
      res.json({ cache: 'memory', timestamp: Date.now() });
    },
  );

  // Always-conditional route: wildcard If-None-Match forces a 304 fast path.
  api.get(
    '/cache/etag-304',
    etag(),
    (_req, res) => {
      res.json({ cache: 'etag' });
    },
  );

  // ── CORS benchmarks ──────────────────────────────────────────────────────
  // Dynamic-whitelist middleware resolving an exact origin and a wildcard
  // tenant pattern per request. Mounted router-level so preflights are
  // answered by the middleware (as in the real app) before route matching.
  const corsMiddleware = createCorsMiddleware({
    allowedOrigins: ['https://app.example.com', 'https://*.tenant.example.com'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  api.use('/cors', corsMiddleware);

  api.get(
    '/cors/allowed',
    (_req, res) => {
      res.json({ cors: 'allowed', timestamp: Date.now() });
    },
  );

  // ── Webhook signature verification benchmarks ──────────────────────────
  // Rotation-aware HMAC verification against a registered key. A valid
  // signature/timestamp pair is precomputed at boot and replayed for the
  // "valid" route; the invalid route signs over a different body so every
  // request exercises the constant-time rejection path.
  const BENCH_WEBHOOK_BODY = JSON.stringify({ event: 'bench.webhook', data: { id: 'bench_w_1' } });
  const BENCH_WEBHOOK_BODY_INVALID = JSON.stringify({ event: 'bench.webhook', data: { id: 'bench_w_2' } });
  const BENCH_WEBHOOK_TS = String(Math.floor(Date.now() / 1000));
  const benchKeyRegistry = new WebhookKeyRegistry({
    keys: [{ provider: 'custom', secret: 'bench_webhook_secret_0123456789abcdef0123456789abcdef' }],
  });
  const benchWebhookSignature = benchKeyRegistry
    .sign({ provider: 'custom', body: BENCH_WEBHOOK_BODY, timestamp: Number(BENCH_WEBHOOK_TS) })
    .signature;
  const benchWebhookSignatureInvalid = benchKeyRegistry
    .sign({ provider: 'custom', body: BENCH_WEBHOOK_BODY_INVALID, timestamp: Number(BENCH_WEBHOOK_TS) })
    .signature;

  const resolveWebhookBody = (body: unknown): string => {
    if (typeof body === 'string') return body;
    if (body && typeof body === 'object' && Object.keys(body as Record<string, unknown>).length > 0) {
      return JSON.stringify(body);
    }
    return BENCH_WEBHOOK_BODY;
  };

  api.post('/webhook/verify', (req, res) => {
    const signature = (req.headers['x-signature'] as string) || benchWebhookSignature;
    const timestamp = (req.headers['x-timestamp'] as string) || BENCH_WEBHOOK_TS;
    const ok = benchKeyRegistry.verify({
      signature,
      timestamp,
      body: resolveWebhookBody(req.body),
      provider: 'custom',
    });
    if (ok.isValid) {
      res.json({ verified: true });
    } else {
      res.status(401).json({ verified: false });
    }
  });

  api.post('/webhook/verify-invalid', (_req, res) => {
    const ok = benchKeyRegistry.verify({
      signature: benchWebhookSignatureInvalid,
      timestamp: BENCH_WEBHOOK_TS,
      body: BENCH_WEBHOOK_BODY,
      provider: 'custom',
    });
    if (ok.isValid) {
      res.json({ verified: true });
    } else {
      res.status(401).json({ verified: false });
    }
  });

  app.use('/api/v1', api);
  return app;
}
