/**
 * Nano (XNO) settle rail API — Issue #1004
 *
 * Endpoints:
 * - GET  /nano/status                  → rail info (feeless, finality, metrics)
 * - POST /nano/escrows                 → hold funds (one feeless send)
 * - POST /nano/escrows/:id/release     → release funds (one feeless send = confirmation)
 * - POST /nano/escrows/:id/refund      → refund funds (one feeless send)
 * - GET  /nano/escrows                 → list escrows (?status=&payer=&payee=)
 * - GET  /nano/escrows/:id             → fetch an escrow
 * - GET  /nano/escrows/:id/receipt     → verify the public release receipt
 * - GET  /nano/blocks/:hash            → look up a block by hash
 * - POST /nano/fund                    → fund an account (sandbox/faucet helper)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  NANO_CONFIG,
  NanoEscrowStatus,
  SUPPORTED_SETTLEMENT_RAILS,
  createNanoSettleRail,
} from '../services/settlement/nano-settle-rail.js';

export const nanoRouter = Router();
export const nanoRail = createNanoSettleRail();

const holdSchema = z.object({
  payer: z.string().min(1),
  payee: z.string().min(1),
  amountXno: z.number().positive(),
  representative: z.string().min(1).optional(),
  escrowId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const releaseSchema = z.object({
  approvedBy: z.string().min(1).optional(),
});

const refundSchema = z.object({
  reason: z.string().min(1).optional(),
});

const fundSchema = z.object({
  address: z.string().min(1),
  amountXno: z.number().positive(),
});

nanoRouter.get(
  '/status',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        rail: 'nano',
        ticker: NANO_CONFIG.ticker,
        decimals: NANO_CONFIG.decimals,
        feeless: true,
        finalityMs: NANO_CONFIG.finalityMs,
        supportedRails: SUPPORTED_SETTLEMENT_RAILS,
        metrics: nanoRail.getMetrics(),
      },
    });
  }),
);

nanoRouter.post(
  '/escrows',
  validate(holdSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const escrow = nanoRail.holdEscrow(req.body);
      res.status(201).json({ success: true, data: escrow });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Unable to hold escrow' },
      });
    }
  }),
);

nanoRouter.get(
  '/escrows',
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as NanoEscrowStatus | undefined;
    const payer = req.query.payer as string | undefined;
    const payee = req.query.payee as string | undefined;
    res.status(200).json({ success: true, data: nanoRail.listEscrows({ status, payer, payee }) });
  }),
);

nanoRouter.get(
  '/escrows/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const escrow = nanoRail.getEscrow(req.params.id);
    if (!escrow) {
      res.status(404).json({ success: false, error: { message: 'Escrow not found' } });
      return;
    }
    res.status(200).json({ success: true, data: escrow });
  }),
);

nanoRouter.post(
  '/escrows/:id/release',
  validate(releaseSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const escrow = nanoRail.releaseEscrow(req.params.id, req.body);
      res.status(200).json({ success: true, data: escrow });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Unable to release escrow' },
      });
    }
  }),
);

nanoRouter.post(
  '/escrows/:id/refund',
  validate(refundSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const escrow = nanoRail.refundEscrow(req.params.id, req.body);
      res.status(200).json({ success: true, data: escrow });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Unable to refund escrow' },
      });
    }
  }),
);

nanoRouter.get(
  '/escrows/:id/receipt',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const receipt = nanoRail.verifyEscrowReceipt(req.params.id);
      res.status(200).json({ success: true, data: receipt });
    } catch (error) {
      res.status(404).json({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Escrow not found' },
      });
    }
  }),
);

nanoRouter.get(
  '/blocks/:hash',
  asyncHandler(async (req: Request, res: Response) => {
    const block = nanoRail.getBlock(req.params.hash);
    if (!block) {
      res.status(404).json({ success: false, error: { message: 'Block not found' } });
      return;
    }
    res.status(200).json({ success: true, data: block });
  }),
);

nanoRouter.post(
  '/fund',
  validate(fundSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { address, amountXno } = req.body as z.infer<typeof fundSchema>;
    try {
      nanoRail.fundAccount(address, amountXno);
      res.status(200).json({ success: true, data: { address, balanceXno: nanoRail.getBalanceXno(address) } });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Unable to fund account' },
      });
    }
  }),
);
