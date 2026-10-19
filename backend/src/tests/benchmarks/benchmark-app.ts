/**
 * Self-contained Express app for benchmarks (no Prisma, Stellar, or job scheduler).
 */
import express from 'express';

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

  app.use('/api/v1', api);
  return app;
}
