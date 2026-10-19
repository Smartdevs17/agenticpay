import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { transferService } from '../services/transfers.js';

export const transfersRouter = Router();

const accountSchema = z.object({
  id: z.string().min(1).optional(),
  currency: z.string().length(3),
  status: z.enum(['active', 'frozen', 'closed']).optional(),
  holderName: z.string().max(120).optional(),
});

const quoteSchema = z.object({
  sourceAccountId: z.string().min(1),
  destinationAccountId: z.string().min(1),
  amount: z.number().positive(),
  destinationCurrency: z.string().length(3).optional(),
});

const createTransferSchema = z.object({
  quoteId: z.string().min(1).optional(),
  sourceAccountId: z.string().min(1),
  destinationAccountId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3),
  destinationCurrency: z.string().length(3).optional(),
  idempotencyKey: z.string().min(1).max(200),
  scheduledFor: z.string().datetime().optional(),
  metadata: z.record(z.string()).optional(),
});

const reverseSchema = z.object({
  reason: z.string().min(1).max(280),
});

/**
 * Map errors thrown by the in-memory transfer service onto AppError so the
 * shared error handler preserves the service's status code and error code.
 */
const serviceHandler =
  (handler: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  asyncHandler(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const serviceError = err as { statusCode?: number; code?: string; message?: string };
      if (typeof serviceError?.statusCode === 'number') {
        throw new AppError(serviceError.statusCode, serviceError.message ?? 'Transfer error', serviceError.code);
      }
      throw err;
    }
  });

// Register an account that can send or receive transfers.
transfersRouter.post(
  '/accounts',
  validate(accountSchema),
  serviceHandler((req: Request, res: Response) => {
    const account = transferService.registerAccount(req.body);
    res.status(201).json({ data: account });
  }),
);

// Price a transfer and lock the fee/FX rate for a short window.
transfersRouter.post(
  '/quotes',
  validate(quoteSchema),
  serviceHandler((req: Request, res: Response) => {
    const quote = transferService.createQuote(req.body);
    res.status(201).json({ data: quote });
  }),
);

// Initiate a transfer. Idempotent on the supplied idempotencyKey.
transfersRouter.post(
  '/transfers',
  validate(createTransferSchema),
  serviceHandler((req: Request, res: Response) => {
    const idempotencyKey = (req.get('Idempotency-Key') as string | undefined) ?? req.body.idempotencyKey;
    const { transfer, idempotent } = transferService.initiateTransfer({
      ...req.body,
      idempotencyKey,
    });
    res.status(idempotent ? 200 : 201).json({ data: transfer, idempotent });
  }),
);

transfersRouter.get(
  '/transfers',
  serviceHandler((req: Request, res: Response) => {
    const { accountId, status, limit, offset } = req.query;
    const result = transferService.listTransfers({
      accountId: accountId as string | undefined,
      status: status as never,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json(result);
  }),
);

transfersRouter.get(
  '/transfers/:id',
  serviceHandler((req: Request, res: Response) => {
    const transfer = transferService.getTransfer(String(req.params.id));
    if (!transfer) throw new AppError(404, 'Transfer not found', 'NOT_FOUND');
    res.json({ data: transfer });
  }),
);

transfersRouter.post(
  '/transfers/:id/cancel',
  serviceHandler((req: Request, res: Response) => {
    const transfer = transferService.cancelTransfer(String(req.params.id));
    res.json({ data: transfer });
  }),
);

transfersRouter.post(
  '/transfers/:id/reverse',
  validate(reverseSchema),
  serviceHandler((req: Request, res: Response) => {
    const transfer = transferService.reverseTransfer(String(req.params.id), req.body.reason);
    res.json({ data: transfer });
  }),
);

transfersRouter.get(
  '/accounts/:id/volume',
  serviceHandler((req: Request, res: Response) => {
    const account = transferService.getAccount(String(req.params.id));
    if (!account) throw new AppError(404, 'Account not found', 'NOT_FOUND');
    res.json({ data: { accountId: account.id, currency: account.currency, dailyVolume: transferService.getDailyVolume(account.id) } });
  }),
);
