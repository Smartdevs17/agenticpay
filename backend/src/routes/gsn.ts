/**
 * GSN (Gas Station Network) Routes
 *
 * POST /gsn/relay               — submit a meta-transaction for sponsorship
 * GET  /gsn/relay/:id           — get relay record status
 * GET  /gsn/relay               — list relay records
 * GET  /gsn/estimate            — EIP-1559 gas estimate
 * POST /gsn/budgets             — create/top-up sponsorship budget
 * GET  /gsn/budgets/:merchantId — get budget details
 * GET  /gsn/budgets/:merchantId/summary — billing summary
 * PUT  /gsn/budgets/:merchantId/policy  — update rate limit / gas cap
 * GET  /gsn/budgets/:merchantId/txs     — list sponsored transactions
 */

import { Router, type Request, type Response } from 'express';
import {
  submitMetaTransaction,
  estimateEIP1559Gas,
  shouldFallbackToUserGas,
  getRelayRecord,
  listRelayRecords,
  type MetaTransactionRequest,
  type GasEstimationConfig,
} from '../services/gsn/relay-server.js';
import {
  createBudget,
  topUpBudget,
  getBudget,
  listBudgets,
  updateBudgetPolicy,
  getBillingSummary,
  listSponsorshipTxs,
} from '../services/gsn/budget-manager.js';

const router = Router();

// Default gas config — in production, fetch from on-chain GasPriceOracle
const DEFAULT_GAS_CONFIG: GasEstimationConfig = {
  baseFeeWei: 20_000_000_000n,    // 20 gwei
  priorityFeeWei: 1_500_000_000n, // 1.5 gwei
  multiplier: 1.2,
};

// ---------------------------------------------------------------------------
// Meta-transaction relay
// ---------------------------------------------------------------------------

router.post('/relay', async (req: Request, res: Response) => {
  const body = req.body as MetaTransactionRequest & { ethUsdPrice?: number };

  if (!body.from || !body.to || !body.signature || !body.merchantId) {
    res.status(400).json({ error: 'from, to, signature, and merchantId are required' });
    return;
  }

  // Check if we should fall back to user-pays-gas
  if (shouldFallbackToUserGas(body.merchantId)) {
    res.status(402).json({
      error: 'sponsorship_budget_exhausted',
      fallback: 'user_pays_gas',
      message: 'Merchant sponsorship budget is exhausted. User must pay gas directly.',
    });
    return;
  }

  try {
    const record = await submitMetaTransaction(body, DEFAULT_GAS_CONFIG, body.ethUsdPrice);

    const statusCode =
      record.status === 'confirmed' ? 200
      : record.status === 'submitted' ? 202
      : 400;

    res.status(statusCode).json({ success: record.status === 'confirmed', record });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.get('/relay', (req: Request, res: Response) => {
  const { merchantId, userWallet, status } = req.query as Record<string, string>;
  const records = listRelayRecords({
    merchantId,
    userWallet,
    status: status as Parameters<typeof listRelayRecords>[0]['status'],
  });
  res.json({ count: records.length, records });
});

router.get('/relay/:id', (req: Request, res: Response) => {
  const record = getRelayRecord(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Relay record not found' });
    return;
  }
  res.json(record);
});

// ---------------------------------------------------------------------------
// Gas estimation
// ---------------------------------------------------------------------------

router.get('/estimate', (req: Request, res: Response) => {
  const gasUnits = parseInt(String(req.query.gasUnits ?? '100000'), 10);
  const ethUsdPrice = req.query.ethUsdPrice ? parseFloat(String(req.query.ethUsdPrice)) : undefined;

  const estimate = estimateEIP1559Gas(gasUnits, DEFAULT_GAS_CONFIG, ethUsdPrice);
  res.json(estimate);
});

// ---------------------------------------------------------------------------
// Budget management
// ---------------------------------------------------------------------------

router.post('/budgets', (req: Request, res: Response) => {
  const { merchantId, depositWei, gasCapPerTx, rateLimitPerDay, topUp } = req.body as {
    merchantId: string;
    depositWei: string;
    gasCapPerTx?: number;
    rateLimitPerDay?: number;
    topUp?: boolean;
  };

  if (!merchantId || !depositWei) {
    res.status(400).json({ error: 'merchantId and depositWei are required' });
    return;
  }

  try {
    const budget = topUp
      ? topUpBudget(merchantId, depositWei)
      : createBudget(merchantId, depositWei, gasCapPerTx ?? 200_000, rateLimitPerDay ?? 50);

    res.status(topUp ? 200 : 201).json(budget);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

router.get('/budgets', (_req: Request, res: Response) => {
  res.json(listBudgets());
});

router.get('/budgets/:merchantId', (req: Request, res: Response) => {
  const budget = getBudget(req.params.merchantId);
  if (!budget) {
    res.status(404).json({ error: 'Budget not found' });
    return;
  }
  res.json(budget);
});

router.get('/budgets/:merchantId/summary', (req: Request, res: Response) => {
  try {
    const includeTxs = req.query.includeTxs === 'true';
    const summary = getBillingSummary(req.params.merchantId, includeTxs);
    res.json(summary);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(404).json({ error: message });
  }
});

router.put('/budgets/:merchantId/policy', (req: Request, res: Response) => {
  try {
    const updated = updateBudgetPolicy(req.params.merchantId, req.body);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

router.get('/budgets/:merchantId/txs', (req: Request, res: Response) => {
  res.json(listSponsorshipTxs(req.params.merchantId));
});

export default router;
