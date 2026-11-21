import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { providerRegistry } from '../services/payments/provider-registry.js';
import { unifiedPaymentTracker } from '../services/payments/unified-payment-tracker.js';
import { selectProviderId } from '../services/payments/payment-router.js';
import type { PaymentInput } from '../services/payments/providers/types.js';

export const paymentStrategiesRouter = Router();

// Drives the strategy configuration UI: lists registered strategies, their
// live health, and running success/error metrics.
paymentStrategiesRouter.get('/', asyncHandler(async (_req, res) => {
  const ids = providerRegistry.list();
  const healthy = new Set(await providerRegistry.listHealthy());
  const strategies = ids.map((id) => ({
    id,
    healthy: healthy.has(id),
    metrics: providerRegistry.getMetrics(id),
  }));
  res.json({ strategies });
}));

// Preview which strategy a given network/token/currency would resolve to,
// without executing a payment. Used by the config UI to explain routing.
paymentStrategiesRouter.post('/preview', asyncHandler(async (req, res) => {
  const { network, currency, token, preferredProviderId } = req.body;
  if (!network || !currency) {
    throw new AppError(400, 'network and currency are required', 'VALIDATION_ERROR');
  }
  const selected = selectProviderId(
    { network, currency, token, amount: 0, toAddress: '', tenantId: '' } as PaymentInput,
    preferredProviderId,
  );
  res.json({ selectedStrategy: selected });
}));

paymentStrategiesRouter.post('/pay', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  const { amount, currency, token, fromAddress, toAddress, network, metadata, preferredProviderId } = req.body;

  if (!tenantId || !amount || !currency || !toAddress || !network) {
    throw new AppError(400, 'tenantId, amount, currency, toAddress, and network are required', 'VALIDATION_ERROR');
  }

  const result = await unifiedPaymentTracker.routeAndTrack(
    { amount, currency, token, fromAddress, toAddress, network, tenantId, metadata },
    preferredProviderId,
  );

  if (!result.ok) {
    throw new AppError(result.error.statusCode, result.error.message, result.error.code, result.error.details);
  }

  res.status(201).json(result.value);
}));

// Unified payment history across every strategy.
paymentStrategiesRouter.get('/payments', asyncHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) throw new AppError(400, 'x-tenant-id header is required', 'VALIDATION_ERROR');

  const payments = await unifiedPaymentTracker.listByTenant(tenantId);
  res.json({ payments });
}));
