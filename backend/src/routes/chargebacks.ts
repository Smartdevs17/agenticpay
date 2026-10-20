import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  createChargeback,
  getChargeback,
  listChargebacks,
  updateChargebackStatus,
  submitEvidence,
  removeEvidence,
  addNote,
  summarizeChargebacks,
  ChargebackStatus,
} from '../services/chargebacks.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validateRequest } from '../middleware/validate.js';

export const chargebacksRouter = Router();

const reasonSchema = z.enum([
  'fraudulent',
  'unrecognized',
  'product_not_received',
  'product_unacceptable',
  'duplicate_charge',
  'subscription_canceled',
  'credit_not_processed',
]);

const statusSchema = z.enum([
  'received',
  'under_review',
  'evidence_required',
  'evidence_submitted',
  'representment',
  'won',
  'lost',
  'accepted',
]);

const evidenceTypeSchema = z.enum([
  'receipt',
  'tracking_number',
  'customer_communication',
  'refund_policy',
  'delivery_proof',
  'signature',
  'avs_cvv_match',
  'ip_location',
  'other',
]);

const idParamsSchema = z.object({ id: z.string().min(1) });

const createChargebackSchema = z.object({
  merchantId: z.string().min(1),
  paymentId: z.string().min(1),
  customerId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().min(1),
  reason: reasonSchema,
  evidenceWindowDays: z.number().int().positive().max(120).optional(),
});

const listQuerySchema = z.object({
  merchantId: z.string().optional(),
  status: statusSchema.optional(),
});

const statusUpdateSchema = z.object({
  status: statusSchema,
  actor: z.string().min(1),
});

const evidenceSchema = z.object({
  type: evidenceTypeSchema,
  description: z.string().min(1),
  fileUrl: z.string().url().optional(),
  submittedBy: z.string().min(1),
});

const noteSchema = z.object({
  note: z.string().min(1),
  actor: z.string().min(1),
});

function notFound(id: string): AppError {
  return new AppError(404, `Chargeback not found: ${id}`, 'CHARGEBACK_NOT_FOUND');
}

/**
 * @route   POST /api/v1/chargebacks
 * @desc    Register a new chargeback case
 */
chargebacksRouter.post(
  '/',
  validateRequest({ body: createChargebackSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const chargeback = createChargeback(req.body);
    res.status(201).json({ success: true, data: chargeback });
  }),
);

/**
 * @route   GET /api/v1/chargebacks/summary
 * @desc    Aggregate chargeback metrics, optionally scoped to a merchant
 */
chargebacksRouter.get('/summary', (req: Request, res: Response) => {
  const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
  res.json({ success: true, data: summarizeChargebacks(merchantId) });
});

/**
 * @route   GET /api/v1/chargebacks
 * @desc    List chargebacks, optionally filtered by merchant or status
 */
chargebacksRouter.get(
  '/',
  validateRequest({ query: listQuerySchema }),
  (req: Request, res: Response) => {
    const data = listChargebacks({
      merchantId: req.query.merchantId as string | undefined,
      status: req.query.status as ChargebackStatus | undefined,
    });
    res.json({ success: true, data, count: data.length });
  },
);

/**
 * @route   GET /api/v1/chargebacks/:id
 * @desc    Retrieve a single chargeback case with evidence and timeline
 */
chargebacksRouter.get(
  '/:id',
  validateRequest({ params: idParamsSchema }),
  (req: Request, res: Response) => {
    const chargeback = getChargeback(req.params.id);
    if (!chargeback) throw notFound(req.params.id);
    res.json({ success: true, data: chargeback });
  },
);

/**
 * @route   PATCH /api/v1/chargebacks/:id/status
 * @desc    Advance a chargeback through its lifecycle
 */
chargebacksRouter.patch(
  '/:id/status',
  validateRequest({ params: idParamsSchema, body: statusUpdateSchema }),
  (req: Request, res: Response) => {
    try {
      const chargeback = updateChargebackStatus(req.params.id, req.body.status, req.body.actor);
      res.json({ success: true, data: chargeback });
    } catch (err) {
      if (err instanceof Error && err.message === 'Chargeback not found') {
        throw notFound(req.params.id);
      }
      throw new AppError(400, (err as Error).message, 'INVALID_STATUS_TRANSITION');
    }
  },
);

/**
 * @route   POST /api/v1/chargebacks/:id/evidence
 * @desc    Submit supporting evidence for a chargeback
 */
chargebacksRouter.post(
  '/:id/evidence',
  validateRequest({ params: idParamsSchema, body: evidenceSchema }),
  (req: Request, res: Response) => {
    try {
      const chargeback = submitEvidence(req.params.id, req.body);
      res.status(201).json({ success: true, data: chargeback });
    } catch (err) {
      if (err instanceof Error && err.message === 'Chargeback not found') {
        throw notFound(req.params.id);
      }
      throw new AppError(400, (err as Error).message, 'EVIDENCE_SUBMISSION_FAILED');
    }
  },
);

/**
 * @route   DELETE /api/v1/chargebacks/:id/evidence/:evidenceId
 * @desc    Remove a previously submitted evidence item
 */
chargebacksRouter.delete(
  '/:id/evidence/:evidenceId',
  validateRequest({ params: idParamsSchema.extend({ evidenceId: z.string().min(1) }) }),
  (req: Request, res: Response) => {
    try {
      const chargeback = removeEvidence(
        req.params.id,
        req.params.evidenceId,
        (req.query.actor as string) || 'system',
      );
      res.json({ success: true, data: chargeback });
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'Chargeback not found') throw notFound(req.params.id);
      throw new AppError(404, message, 'EVIDENCE_NOT_FOUND');
    }
  },
);

/**
 * @route   POST /api/v1/chargebacks/:id/notes
 * @desc    Attach an internal note to a chargeback case
 */
chargebacksRouter.post(
  '/:id/notes',
  validateRequest({ params: idParamsSchema, body: noteSchema }),
  (req: Request, res: Response) => {
    try {
      const chargeback = addNote(req.params.id, req.body.note, req.body.actor);
      res.status(201).json({ success: true, data: chargeback });
    } catch (err) {
      if (err instanceof Error && err.message === 'Chargeback not found') {
        throw notFound(req.params.id);
      }
      throw err;
    }
  },
);
