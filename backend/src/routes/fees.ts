import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { feeEngineService } from '../services/fees/fee-engine.js';
import { AppError } from '../middleware/errorHandler.js';

export const feesRouter = Router();

feesRouter.post('/calculate', asyncHandler(async (req, res) => {
  const { amount, merchantId, currency, chain, gasPriceGwei } = req.body;
  const tenantId = req.headers['x-tenant-id'] as string;

  if (amount == null || !tenantId) {
    throw new AppError(400, 'amount and x-tenant-id are required', 'VALIDATION_ERROR');
  }

  const result = await feeEngineService.calculate({
    tenantId, merchantId, amount, currency, chain, gasPriceGwei,
  });
  res.json(result);
}));

feesRouter.get('/preview', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  const amount = parseFloat(req.query.amount as string);
  const merchantId = req.query.merchantId as string;

  if (!amount || !tenantId) {
    throw new AppError(400, 'amount query param and x-tenant-id header are required', 'VALIDATION_ERROR');
  }

  const result = await feeEngineService.preview(tenantId, amount, merchantId);
  res.json(result);
}));

feesRouter.get('/schedules', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  const status = req.query.status as string;

  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const schedules = await feeEngineService.listFeeSchedules(tenantId, status);
  res.json(schedules);
}));

feesRouter.post('/schedules', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const schedule = await feeEngineService.createFeeSchedule(tenantId, req.body);
  res.status(201).json(schedule);
}));

feesRouter.get('/schedules/:id', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const schedule = await feeEngineService.getFeeSchedule(req.params.id, tenantId);
  res.json(schedule);
}));

feesRouter.put('/schedules/:id', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const schedule = await feeEngineService.updateFeeSchedule(req.params.id, tenantId, req.body);
  res.json(schedule);
}));

feesRouter.delete('/schedules/:id', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  await feeEngineService.deleteFeeSchedule(req.params.id, tenantId);
  res.json({ success: true });
}));

feesRouter.post('/schedules/:id/overrides', asyncHandler(async (req, res) => {
  const { merchantId, flatFee, percentageFee, minFee, maxFee, effectiveFrom, effectiveTo } = req.body;

  if (!merchantId) {
    throw new AppError(400, 'merchantId is required', 'VALIDATION_ERROR');
  }

  const override = await feeEngineService.setMerchantOverride(req.params.id, merchantId, {
    flatFee, percentageFee, minFee, maxFee, effectiveFrom, effectiveTo,
  });
  res.status(201).json(override);
}));

feesRouter.post('/schedules/:id/change-log', asyncHandler(async (req, res) => {
  const { field, oldValue, newValue, reason } = req.body;
  if (!field) throw new AppError(400, 'field is required', 'VALIDATION_ERROR');

  const log = await feeEngineService.logFeeChange(
    req.params.id, field, oldValue, newValue, (req as any).user?.id, reason,
  );
  res.status(201).json(log);
}));
