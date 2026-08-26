import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { flashLoanProtectionService } from '../services/liquidity/flash-loan-protection.js';
import { priceValidator } from '../services/liquidity/price-validator.js';
import { AppError } from '../middleware/errorHandler.js';

export const liquidityProtectionRouter = Router();

liquidityProtectionRouter.post('/check', asyncHandler(async (req, res) => {
  const { poolId, tokenPair, executionPrice, referencePrice, txHash } = req.body;
  const tenantId = req.headers['x-tenant-id'] as string;

  if (!poolId || !tokenPair || executionPrice == null || referencePrice == null) {
    throw new AppError(400, 'poolId, tokenPair, executionPrice, and referencePrice are required', 'VALIDATION_ERROR');
  }
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const result = await flashLoanProtectionService.checkTransaction(
    tenantId, poolId, tokenPair, executionPrice, referencePrice, txHash,
  );
  res.json(result);
}));

liquidityProtectionRouter.get('/status/:poolId', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const status = await flashLoanProtectionService.getPoolProtectionStatus(
    req.params.poolId, tenantId,
  );
  res.json(status);
}));

liquidityProtectionRouter.get('/anomalies/:poolId', asyncHandler(async (req, res) => {
  const { poolId } = req.params;
  const minutes = parseInt(req.query.minutes as string) || 60;
  const minSeverity = req.query.severity as string;

  const anomalies = await priceValidator.getRecentAnomalies(poolId, minutes, minSeverity);
  res.json({ anomalies, count: anomalies.length });
}));

liquidityProtectionRouter.get('/metrics/:poolId', asyncHandler(async (req, res) => {
  const hours = parseInt(req.query.hours as string) || 24;
  const metrics = await priceValidator.getPoolPriceMetrics(req.params.poolId, hours);
  res.json(metrics || { message: 'No data for this period' });
}));

liquidityProtectionRouter.get('/circuit-breaker/:poolId', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const status = await flashLoanProtectionService.getCircuitBreakerStatus(
    req.params.poolId, tenantId,
  );
  res.json(status);
}));

liquidityProtectionRouter.post('/circuit-breaker/trigger', asyncHandler(async (req, res) => {
  const { poolId, eventType, reason } = req.body;
  const tenantId = req.headers['x-tenant-id'] as string;

  if (!poolId || !eventType || !tenantId) {
    throw new AppError(400, 'poolId, eventType, and x-tenant-id are required', 'VALIDATION_ERROR');
  }

  const event = await flashLoanProtectionService.triggerCircuitBreaker(
    tenantId, poolId, eventType, reason || 'Manual trigger',
  );
  res.json(event);
}));

liquidityProtectionRouter.post('/circuit-breaker/recover/:eventId', asyncHandler(async (req, res) => {
  const event = await flashLoanProtectionService.recoverCircuitBreaker(req.params.eventId);
  res.json(event);
}));

liquidityProtectionRouter.get('/twap/:poolId', asyncHandler(async (req, res) => {
  const lookback = parseInt(req.query.lookbackMinutes as string) || 15;
  const twapPrice = await flashLoanProtectionService.getTWAPPrice(req.params.poolId, lookback);
  res.json({ poolId: req.params.poolId, twapPrice, lookbackMinutes: lookback });
}));
