import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { paymentRetryService, PaymentRetryConfig } from '../services/retry/payment.js';
import { retryService } from '../services/retry/index.js';

export const retryRouter = Router();

retryRouter.get('/config/:paymentType', asyncHandler(async (req, res) => {
  const { paymentType } = req.params;
  const config = paymentRetryService.getConfig(paymentType);
  res.json({ paymentType, config });
}));

retryRouter.post('/config/:paymentType', asyncHandler(async (req, res) => {
  const { paymentType } = req.params;
  const configUpdates = req.body;
  paymentRetryService.setConfig(paymentType, configUpdates);
  res.json({ success: true, paymentType, config: paymentRetryService.getConfig(paymentType) });
}));

retryRouter.get('/status/:paymentId', asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const state = paymentRetryService.getPaymentState(paymentId);
  
  if (!state) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }
  
  res.json(state);
}));

retryRouter.get('/status', asyncHandler(async (req, res) => {
  const states = paymentRetryService.getAllPaymentStates();
  res.json({ payments: states, total: states.length });
}));

retryRouter.post('/retry/:paymentId', asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { paymentType = 'default', operation, manualOverride = true } = req.body;
  
  if (!operation) {
    res.status(400).json({ error: 'operation function is required' });
    return;
  }
  
  const result = await paymentRetryService.retryPayment(
    paymentId,
    paymentType,
    async () => {
      return operation();
    },
    manualOverride
  );
  
  res.json({
    paymentId,
    ...result,
  });
}));

retryRouter.post('/manual-retry/:paymentId', asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  paymentRetryService.queueManualRetry(paymentId);
  res.json({ success: true, paymentId, message: 'Added to manual retry queue' });
}));

retryRouter.post('/cancel/:paymentId', asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  paymentRetryService.cancelPayment(paymentId);
  res.json({ success: true, paymentId, message: 'Payment cancelled' });
}));

retryRouter.get('/analytics', asyncHandler(async (req, res) => {
  const analytics = paymentRetryService.getRetryAnalytics();
  res.json(analytics);
}));

retryRouter.get('/metrics', asyncHandler(async (req, res) => {
  const metrics = paymentRetryService.getAllRetryMetrics();
  const metricsArray: { paymentType: string; metrics: any }[] = [];
  
  for (const [paymentType, m] of metrics) {
    metricsArray.push({ paymentType, metrics: m });
  }
  
  res.json({
    metrics: metricsArray,
    circuitBreakers: Object.fromEntries(paymentRetryService.getCircuitBreakerStates()),
  });
}));

retryRouter.get('/metrics/:paymentType', asyncHandler(async (req, res) => {
  const { paymentType } = req.params;
  const metrics = paymentRetryService.getRetryMetrics(paymentType);
  
  if (!metrics) {
    res.status(404).json({ error: 'No metrics found for payment type' });
    return;
  }
  
  res.json({ paymentType, metrics });
}));

retryRouter.post('/reset/:paymentId', asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  paymentRetryService.resetPayment(paymentId);
  res.json({ success: true, paymentId, message: 'Payment state reset' });
}));

retryRouter.post('/reset', asyncHandler(async (req, res) => {
  paymentRetryService.resetAll();
  res.json({ success: true, message: 'All retry state reset' });
}));