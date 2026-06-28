import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { getBridgeMonitorService } from '../services/bridge-monitor/bridge-monitor.js';

export const bridgeMonitorRouter = Router();

const trackSchema = z.object({
  provider: z.enum(['wormhole', 'layerzero', 'axelar', 'custom']),
  messageId: z.string().min(1),
  sourceChain: z.string().min(1),
  destinationChain: z.string().min(1),
  status: z.enum([
    'initiated',
    'source_confirmed',
    'relayed',
    'destination_executed',
    'failed',
    'stuck',
    'expired',
  ]),
  txHashSource: z.string().optional(),
  txHashDestination: z.string().optional(),
  amount: z.string().optional(),
  tokenAddress: z.string().optional(),
  sender: z.string().optional(),
  recipient: z.string().optional(),
  gasCostSource: z.string().optional(),
  gasCostDestination: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

bridgeMonitorRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const result = await getBridgeMonitorService().getHealth();
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);

bridgeMonitorRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const days = parseInt(String(req.query.days ?? '30'), 10);
    const result = await getBridgeMonitorService().getAnalytics(days);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);

bridgeMonitorRouter.get(
  '/messages',
  asyncHandler(async (req, res) => {
    const result = await getBridgeMonitorService().listMessages({
      provider: req.query.provider as 'wormhole' | 'layerzero' | 'axelar' | 'custom' | undefined,
      status: req.query.status as
        | 'initiated'
        | 'source_confirmed'
        | 'relayed'
        | 'destination_executed'
        | 'failed'
        | 'stuck'
        | 'expired'
        | undefined,
      limit: parseInt(String(req.query.limit ?? '50'), 10),
    });
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);

bridgeMonitorRouter.post(
  '/messages',
  validate(trackSchema),
  asyncHandler(async (req, res) => {
    const result = await getBridgeMonitorService().trackMessage(req.body);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.status(201).json(result.value);
  }),
);

bridgeMonitorRouter.post(
  '/messages/:id/retry',
  asyncHandler(async (req, res) => {
    const initiatedBy = req.headers['x-user-id'] as string | undefined;
    const result = await getBridgeMonitorService().retryMessage(req.params.id, initiatedBy);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);

bridgeMonitorRouter.post(
  '/poll',
  asyncHandler(async (_req, res) => {
    await getBridgeMonitorService().pollAndReconcile();
    res.json({ polled: true, timestamp: new Date().toISOString() });
  }),
);
