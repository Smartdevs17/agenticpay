import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { marketplaceEscrowService } from '../services/marketplace-escrow.js';

export const marketplaceEscrowRouter = Router();

const milestoneSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  amount: z.number().positive(),
});

const createOrderSchema = z.object({
  marketplaceId: z.string().min(1),
  externalOrderId: z.string().min(1),
  buyerId: z.string().min(1),
  sellerId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  platformFeePercent: z.number().min(0).max(100).optional(),
  inspectionPeriodMs: z.number().int().nonnegative().optional(),
  milestones: z.array(milestoneSchema).min(1).optional(),
});

const shipSchema = z.object({
  trackingInfo: z.string().max(200).optional(),
});

const disputeSchema = z.object({
  raisedBy: z.string().min(1),
  reason: z.string().min(1).max(500),
});

const resolveSchema = z.object({
  resolution: z.enum(['buyer', 'seller', 'split']),
  buyerPercent: z.number().min(0).max(100).optional(),
  approvedBy: z.string().min(1),
});

const refundSchema = z.object({
  reason: z.string().min(1).max(500),
});

const releaseSchema = z.object({
  approvedBy: z.string().min(1).optional(),
});

/**
 * Preserve service-level status codes (404/409/403) when they surface as errors.
 */
const serviceHandler =
  (handler: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  asyncHandler(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const serviceError = err as { statusCode?: number; code?: string; message?: string };
      if (typeof serviceError?.statusCode === 'number') {
        throw new AppError(serviceError.statusCode, serviceError.message ?? 'Escrow error', serviceError.code);
      }
      throw err;
    }
  });

marketplaceEscrowRouter.post(
  '/orders',
  validate(createOrderSchema),
  serviceHandler((req: Request, res: Response) => {
    res.status(201).json({ data: marketplaceEscrowService.createOrder(req.body) });
  }),
);

marketplaceEscrowRouter.get(
  '/orders',
  serviceHandler((req: Request, res: Response) => {
    const { marketplaceId, buyerId, sellerId, status, limit, offset } = req.query;
    res.json(
      marketplaceEscrowService.listOrders({
        marketplaceId: marketplaceId as string | undefined,
        buyerId: buyerId as string | undefined,
        sellerId: sellerId as string | undefined,
        status: status as never,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      }),
    );
  }),
);

marketplaceEscrowRouter.get(
  '/settlements/:marketplaceId',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: marketplaceEscrowService.getSettlementSummary(String(req.params.marketplaceId)) });
  }),
);

marketplaceEscrowRouter.get(
  '/orders/:id',
  serviceHandler((req: Request, res: Response) => {
    const order = marketplaceEscrowService.getOrder(String(req.params.id));
    if (!order) throw new AppError(404, 'Marketplace order not found', 'NOT_FOUND');
    res.json({ data: order });
  }),
);

marketplaceEscrowRouter.get(
  '/orders/:id/payout',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: marketplaceEscrowService.getPayoutBreakdown(String(req.params.id)) });
  }),
);

marketplaceEscrowRouter.post(
  '/orders/:id/fund',
  serviceHandler((req: Request, res: Response) => {
    const { txHash } = req.body ?? {};
    res.json({ data: marketplaceEscrowService.fundOrder(String(req.params.id), txHash) });
  }),
);

marketplaceEscrowRouter.post(
  '/orders/:id/ship',
  validate(shipSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: marketplaceEscrowService.markShipped(String(req.params.id), req.body.trackingInfo) });
  }),
);

marketplaceEscrowRouter.post(
  '/orders/:id/deliver',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: marketplaceEscrowService.markDelivered(String(req.params.id)) });
  }),
);

marketplaceEscrowRouter.post(
  '/orders/:id/release',
  validate(releaseSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: marketplaceEscrowService.release(String(req.params.id), req.body.approvedBy) });
  }),
);

marketplaceEscrowRouter.post(
  '/orders/:id/milestones/:milestoneId/release',
  validate(releaseSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({
      data: marketplaceEscrowService.releaseMilestone(
        String(req.params.id),
        String(req.params.milestoneId),
        req.body.approvedBy,
      ),
    });
  }),
);

marketplaceEscrowRouter.post(
  '/orders/:id/auto-release',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: marketplaceEscrowService.autoRelease(String(req.params.id)) });
  }),
);

marketplaceEscrowRouter.post(
  '/orders/:id/dispute',
  validate(disputeSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: marketplaceEscrowService.raiseDispute(String(req.params.id), req.body) });
  }),
);

marketplaceEscrowRouter.post(
  '/orders/:id/resolve',
  validate(resolveSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: marketplaceEscrowService.resolveDispute(String(req.params.id), req.body) });
  }),
);

marketplaceEscrowRouter.post(
  '/orders/:id/refund',
  validate(refundSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: marketplaceEscrowService.refund(String(req.params.id), req.body.reason) });
  }),
);

marketplaceEscrowRouter.post(
  '/orders/:id/cancel',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: marketplaceEscrowService.cancelOrder(String(req.params.id)) });
  }),
);
