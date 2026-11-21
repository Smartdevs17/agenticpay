import { Router } from 'express';
import {
  getAccountInfo,
  getTransactionStatus,
  getGasEstimator,
  getNonceManager,
  InvalidStellarInputError,
  UnitOfWork,
  createUnitOfWork,
} from '../services/stellar.js';
import { getTransactionMonitor } from '../services/transaction-monitor.js';
import type { TxStatus } from '../services/transaction-monitor.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';
import { batchProcessor } from '../services/batch.js';
import { featureFlags } from '../config/featureFlags.js';

export const stellarRouter = Router();

stellarRouter.get('/account/:address', cacheControl({ maxAge: CacheTTL.SHORT }), async (req, res) => {
  try {
    const account = await getAccountInfo(req.params.address);
    return res.json(account);
  } catch (error) {
    if (error instanceof InvalidStellarInputError) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Stellar account error:', error);
    return res.status(500).json({ message: 'Failed to fetch account info' });
  }
});

stellarRouter.get('/tx/:hash', cacheControl({ maxAge: CacheTTL.IMMUTABLE }), async (req, res) => {
  try {
    const tx = await getTransactionStatus(req.params.hash);
    return res.json(tx);
  } catch (error) {
    if (error instanceof InvalidStellarInputError) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Stellar tx error:', error);
    return res.status(500).json({ message: 'Failed to fetch transaction' });
  }
});

stellarRouter.get('/fees', cacheControl({ maxAge: CacheTTL.SHORT }), async (_req, res) => {
  try {
    const fees = await getGasEstimator().estimateFee(1);
    return res.json(fees);
  } catch (error) {
    console.error('Fee estimation error:', error);
    return res.status(500).json({ message: 'Failed to estimate fees' });
  }
});

stellarRouter.post('/batch', async (req, res) => {
  if (!featureFlags.evaluate('batch-operations')) {
    return res.status(403).json({ message: 'Batch operations are disabled' });
  }

  try {
    const { items } = req.body as { items: Array<{ id: string; type: string; data: unknown }> };

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ message: 'items array is required' });
    }

    if (items.length === 0) {
      return res.status(400).json({ message: 'items array must not be empty' });
    }

    for (const item of items) {
      batchProcessor.enqueue({
        id: item.id,
        type: item.type,
        data: item.data,
        priority: 0,
      });
    }

    const results = await batchProcessor.flush();
    return res.json({ batched: items.length, results });
  } catch (error) {
    console.error('Batch error:', error);
    return res.status(500).json({ message: 'Failed to process batch' });
  }
});

stellarRouter.post('/unit-of-work', async (req, res) => {
  try {
    const { operations, sourceAddress } = req.body as {
      operations: Array<{ type: string; data: unknown }>;
      sourceAddress?: string;
    };

    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      return res.status(400).json({ message: 'operations array is required and must not be empty' });
    }

    const uow = createUnitOfWork();

    if (sourceAddress) {
      uow.setSourceAddress(sourceAddress);
    }

    for (const op of operations) {
      uow.addOperation(
        op.type,
        async () => {
          return `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        },
        async () => {
          console.log(`[UnitOfWork] Compensation for ${op.type}`);
        },
      );
    }

    const result = await uow.commit();
    const status = result.success ? 200 : 500;
    return res.status(status).json(result);
  } catch (error) {
    console.error('Unit of work error:', error);
    return res.status(500).json({ message: 'Failed to execute unit of work' });
  }
});

stellarRouter.get('/nonce/:address', async (req, res) => {
  try {
    const state = getNonceManager().getState(req.params.address);
    return res.json({ address: req.params.address, nonceState: state || null });
  } catch (error) {
    console.error('Nonce state error:', error);
    return res.status(500).json({ message: 'Failed to get nonce state' });
  }
});

stellarRouter.post('/nonce/release/:address', async (req, res) => {
  try {
    getNonceManager().release(req.params.address);
    return res.json({ address: req.params.address, released: true });
  } catch (error) {
    console.error('Nonce release error:', error);
    return res.status(500).json({ message: 'Failed to release nonce' });
  }
});

// ── Transaction monitoring endpoints (Issue #402) ─────────────────────────────

stellarRouter.post('/monitor', async (req, res) => {
  try {
    const { txHash, sourceAddress, network, metadata, maxRetries } = req.body as {
      txHash?: string;
      sourceAddress?: string;
      network?: string;
      metadata?: Record<string, unknown>;
      maxRetries?: number;
    };

    if (!txHash || typeof txHash !== 'string') {
      return res.status(400).json({ message: 'txHash is required' });
    }

    const tracked = getTransactionMonitor().track(txHash, { sourceAddress, network, metadata, maxRetries });
    return res.status(201).json(tracked);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid transaction hash')) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Monitor track error:', error);
    return res.status(500).json({ message: 'Failed to register transaction for monitoring' });
  }
});

stellarRouter.get('/monitor/health', cacheControl({ maxAge: CacheTTL.SHORT }), (_req, res) => {
  return res.json(getTransactionMonitor().healthSummary());
});

stellarRouter.get('/monitor/transactions', (req, res) => {
  const { status } = req.query as { status?: string };
  const monitor = getTransactionMonitor();
  const txs = status
    ? monitor.getByStatus(status as TxStatus)
    : monitor.getAll();
  return res.json({ transactions: txs, count: txs.length });
});

stellarRouter.get('/monitor/transactions/:id', (req, res) => {
  const tx = getTransactionMonitor().getById(req.params.id);
  if (!tx) return res.status(404).json({ message: 'Transaction not found' });
  return res.json(tx);
});

stellarRouter.post('/monitor/transactions/:hash/reorg', (req, res) => {
  const tx = getTransactionMonitor().markReorged(req.params.hash);
  if (!tx) return res.status(404).json({ message: 'Transaction not found' });
  return res.json(tx);
});

stellarRouter.get('/monitor/alerts', (req, res) => {
  const unacknowledgedOnly = req.query.unacknowledged === 'true';
  const alerts = getTransactionMonitor().getAlerts(unacknowledgedOnly);
  return res.json({ alerts, count: alerts.length });
});

stellarRouter.post('/monitor/alerts/:id/acknowledge', (req, res) => {
  const ok = getTransactionMonitor().acknowledgeAlert(req.params.id);
  if (!ok) return res.status(404).json({ message: 'Alert not found' });
  return res.json({ acknowledged: true });
});
