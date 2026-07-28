/**
 * Gas estimation HTTP surface.
 *
 * Endpoints are deliberately side-effect-free — they read from the
 * in-process baseline registry and return stable, deterministic numbers.
 * They intentionally don't call out to an RPC; consumers who need the
 * real `eth_estimateGas` should keep using `viem`/`ethers` directly.
 */
import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  batchEstimateSchema,
  estimateSchema,
  metaTxEstimateSchema,
} from '../schemas/gas.js';
import {
  createBudgetSchema,
  checkBudgetSchema,
  recordUsageSchema,
} from '../schemas/gas-budget.js';
import {
  composeFees,
  estimate,
  estimateBatch,
  estimateMetaTx,
  listBaselines,
  listTargets,
  recommendGasPrice,
  getGasPriceStats,
  isGasSurging,
} from '../services/gas.js';
import { predictAll } from '../services/gas/price-predictor.js';
import { gasBudgetManager } from '../services/gas/budget-manager.js';
import { gasAlertService } from '../services/gas/alert-service.js';
import { gasEstimateService } from '../services/gasEstimate.js';
import { gasAccuracyBenchmark } from '../services/gas/accuracy-benchmark.js';
import { gasStorageService } from '../services/gas/gas-storage.js';
import { getGasEstimateCache } from '../services/gas/cache-service.js';

export const gasRouter = Router();

gasRouter.get(
  '/targets',
  asyncHandler(async (_req, res) => {
    res.json({ data: listTargets(), timestamp: new Date() });
  }),
);

gasRouter.get(
  '/benchmarks',
  asyncHandler(async (_req, res) => {
    res.json({ data: listBaselines(), timestamp: new Date() });
  }),
);

gasRouter.post(
  '/estimate',
  validate(estimateSchema),
  asyncHandler(async (req, res) => {
    try {
      const result = estimate(req.body);
      const fees = req.body.fee ? composeFees(result, req.body.fee) : undefined;
      res.json({ data: { estimate: result, fees }, timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'GAS_ESTIMATE_FAILED');
    }
  }),
);

gasRouter.post(
  '/batch/estimate',
  validate(batchEstimateSchema),
  asyncHandler(async (req, res) => {
    try {
      res.json({ data: estimateBatch(req.body), timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'GAS_BATCH_ESTIMATE_FAILED');
    }
  }),
);

gasRouter.post(
  '/meta-tx/estimate',
  validate(metaTxEstimateSchema),
  asyncHandler(async (req, res) => {
    try {
      res.json({ data: estimateMetaTx(req.body), timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'GAS_META_TX_ESTIMATE_FAILED');
    }
  }),
);

// ── Gas Price Prediction (#479) ─────────────────────────────────────────────

gasRouter.get(
  '/predict',
  asyncHandler(async (_req, res) => {
    res.json({ data: predictAll(), timestamp: new Date() });
  }),
);

gasRouter.get(
  '/recommendations',
  asyncHandler(async (_req, res) => {
    res.json({ data: recommendGasPrice(), timestamp: new Date() });
  }),
);

gasRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    res.json({ data: getGasPriceStats(), timestamp: new Date() });
  }),
);

gasRouter.get(
  '/surge',
  asyncHandler(async (_req, res) => {
    res.json({ data: { surging: isGasSurging() }, timestamp: new Date() });
  }),
);

// ── Gas Budget Management (#479) ─────────────────────────────────────────────

gasRouter.post(
  '/budget',
  validate(createBudgetSchema),
  asyncHandler(async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] as string ?? 'default';
    const result = await gasBudgetManager.upsertBudget({ ...req.body, tenantId, resetAt: new Date(req.body.resetAt) });
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.status(201).json({ data: result.value, timestamp: new Date() });
  }),
);

gasRouter.get(
  '/budget/:walletAddress/:chainId',
  asyncHandler(async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] as string ?? 'default';
    const chainId = parseInt(req.params.chainId, 10);
    const result = await gasBudgetManager.getBudget(tenantId, req.params.walletAddress, chainId);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json({ data: result.value, timestamp: new Date() });
  }),
);

gasRouter.delete(
  '/budget/:id',
  asyncHandler(async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] as string ?? 'default';
    const result = await gasBudgetManager.deleteBudget(req.params.id, tenantId);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.status(204).send();
  }),
);

gasRouter.post(
  '/budget/check',
  validate(checkBudgetSchema),
  asyncHandler(async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] as string ?? 'default';
    const { walletAddress, chainId, estimatedGwei } = req.body as { walletAddress: string; chainId: number; estimatedGwei: number };
    const result = await gasBudgetManager.checkBudget(tenantId, walletAddress, chainId, estimatedGwei);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json({ data: result.value, timestamp: new Date() });
  }),
);

gasRouter.post(
  '/budget/usage',
  validate(recordUsageSchema),
  asyncHandler(async (req, res) => {
    const tenantId = req.headers['x-tenant-id'] as string ?? 'default';
    const { walletAddress, chainId, usedGwei } = req.body as { walletAddress: string; chainId: number; usedGwei: number };
    const result = await gasBudgetManager.recordUsage(tenantId, walletAddress, chainId, usedGwei);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json({ data: { recorded: true }, timestamp: new Date() });
  }),
);

// ── Gas Alerts (#479) ────────────────────────────────────────────────────────

gasRouter.post(
  '/alerts',
  asyncHandler(async (req, res) => {
    const { network, thresholdGwei } = req.body as { network: string; thresholdGwei: number };
    if (!network || typeof thresholdGwei !== 'number') {
      throw new AppError(400, 'network and thresholdGwei are required', 'VALIDATION_ERROR');
    }
    gasAlertService.register({
      network,
      thresholdGwei,
      callback: (n, gwei) => {
        console.warn(`[GasAlert] Network ${n} gas price ${gwei} Gwei exceeds threshold ${thresholdGwei}`);
      },
    });
    res.status(201).json({ data: { registered: true, network, thresholdGwei }, timestamp: new Date() });
  }),
);

// ── Enhanced Gas Estimation with Network Congestion ─────────────────────────────

gasRouter.get(
  '/congestion/:chainId',
  asyncHandler(async (req, res) => {
    const chainId = parseInt(req.params.chainId, 10);
    const chainType = (req.query.chainType as 'evm' | 'stellar') || 'evm';
    const congestion = await gasEstimateService.getCurrentCongestion(chainId, chainType);
    res.json({ data: congestion, timestamp: new Date() });
  }),
);

gasRouter.get(
  '/recommendation/:chainId',
  asyncHandler(async (req, res) => {
    const chainId = parseInt(req.params.chainId, 10);
    const chainType = (req.query.chainType as 'evm' | 'stellar') || 'evm';
    const priorityLevel = (req.query.priority as 'low' | 'medium' | 'high' | 'urgent') || 'medium';
    const recommendation = await gasEstimateService.getGasRecommendation(chainId, chainType, priorityLevel);
    res.json({ data: recommendation, timestamp: new Date() });
  }),
);

gasRouter.get(
  '/recommendations/:chainId/all',
  asyncHandler(async (req, res) => {
    const chainId = parseInt(req.params.chainId, 10);
    const chainType = (req.query.chainType as 'evm' | 'stellar') || 'evm';
    const recommendations = await gasEstimateService.getAllPriorityRecommendations(chainId, chainType);
    res.json({ data: recommendations, timestamp: new Date() });
  }),
);

gasRouter.get(
  '/predict/:chainId',
  asyncHandler(async (req, res) => {
    const chainId = parseInt(req.params.chainId, 10);
    const chainType = (req.query.chainType as 'evm' | 'stellar') || 'evm';
    const timeHorizon = parseInt(req.query.horizon as string, 10) || 60;
    const prediction = await gasEstimateService.predictGasPrice(chainId, chainType, timeHorizon);
    res.json({ data: prediction, timestamp: new Date() });
  }),
);

gasRouter.get(
  '/surge/:chainId',
  asyncHandler(async (req, res) => {
    const chainId = parseInt(req.params.chainId, 10);
    const threshold = parseInt(req.query.threshold as string, 10) || 70;
    const surging = gasEstimateService.isNetworkSurging(chainId, threshold);
    res.json({ data: { surging, chainId, threshold }, timestamp: new Date() });
  }),
);

// ── Gas Price History & Storage ────────────────────────────────────────────────

gasRouter.get(
  '/history/:chainId',
  asyncHandler(async (req, res) => {
    const chainId = parseInt(req.params.chainId, 10);
    const network = req.query.network as string || 'ethereum';
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const history = await gasStorageService.getGasPriceHistory(network, chainId, startDate, endDate, limit);
    res.json({ data: history, timestamp: new Date() });
  }),
);

gasRouter.post(
  '/history',
  asyncHandler(async (req, res) => {
    const { network, chainId, baseFeeGwei, priorityFeeGwei, gasUsed, blockNumber } = req.body;
    if (!network || !chainId || baseFeeGwei === undefined) {
      throw new AppError(400, 'network, chainId, and baseFeeGwei are required', 'VALIDATION_ERROR');
    }
    await gasStorageService.storeGasPriceHistory({
      network,
      chainId,
      baseFeeGwei,
      priorityFeeGwei,
      gasUsed,
      blockNumber,
    });
    res.status(201).json({ data: { recorded: true }, timestamp: new Date() });
  }),
);

// ── Accuracy Benchmarking ───────────────────────────────────────────────────────

gasRouter.post(
  '/benchmark',
  asyncHandler(async (req, res) => {
    const { network, chainId, operation, estimatedGas, actualGas } = req.body;
    if (!network || !chainId || !operation || !estimatedGas || !actualGas) {
      throw new AppError(400, 'network, chainId, operation, estimatedGas, and actualGas are required', 'VALIDATION_ERROR');
    }
    const result = await gasAccuracyBenchmark.recordBenchmark(
      network,
      chainId,
      operation,
      BigInt(estimatedGas),
      BigInt(actualGas)
    );
    res.status(201).json({ data: result, timestamp: new Date() });
  }),
);

gasRouter.get(
  '/benchmark/stats/:chainId',
  asyncHandler(async (req, res) => {
    const chainId = parseInt(req.params.chainId, 10);
    const network = req.query.network as string || 'ethereum';
    const operation = req.query.operation as string;
    const stats = await gasAccuracyBenchmark.getBenchmarkStats(network, chainId, operation);
    res.json({ data: stats, timestamp: new Date() });
  }),
);

gasRouter.get(
  '/benchmark/report/:chainId',
  asyncHandler(async (req, res) => {
    const chainId = parseInt(req.params.chainId, 10);
    const network = req.query.network as string || 'ethereum';
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
    const report = await gasAccuracyBenchmark.generateAccuracyReport(network, chainId, startDate, endDate);
    res.json({ data: report, timestamp: new Date() });
  }),
);

gasRouter.get(
  '/benchmark/poor-accuracy/:chainId',
  asyncHandler(async (req, res) => {
    const chainId = parseInt(req.params.chainId, 10);
    const network = req.query.network as string || 'ethereum';
    const threshold = parseInt(req.query.threshold as string, 10) || 25;
    const poorAccuracy = await gasAccuracyBenchmark.identifyPoorAccuracy(network, chainId, threshold);
    res.json({ data: poorAccuracy, timestamp: new Date() });
  }),
);

// ── Cache Management ───────────────────────────────────────────────────────────

gasRouter.get(
  '/cache/stats',
  asyncHandler(async (req, res) => {
    try {
      const cache = getGasEstimateCache();
      const stats = await cache.getStats();
      res.json({ data: stats, timestamp: new Date() });
    } catch (error) {
      throw new AppError(503, 'Cache service not available', 'CACHE_UNAVAILABLE');
    }
  }),
);

gasRouter.delete(
  '/cache',
  asyncHandler(async (req, res) => {
    try {
      const cache = getGasEstimateCache();
      await cache.clear();
      res.json({ data: { cleared: true }, timestamp: new Date() });
    } catch (error) {
      throw new AppError(503, 'Cache service not available', 'CACHE_UNAVAILABLE');
    }
  }),
);

function translate(err: unknown, status: number, code: string): AppError {
  if (err instanceof AppError) return err;
  return new AppError(status, err instanceof Error ? err.message : String(err), code);
}
