import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  accountingInvoiceSchema,
  accountingPaymentSchema,
} from '../integrations/accounting/types.js';
import { xeroService } from '../integrations/xero/index.js';

export const xeroRouter = Router();

xeroRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const configured = xeroService.isConfigured();
    const reachable = configured ? await xeroService.ping() : false;
    res.json({ configured, reachable });
  }),
);

/**
 * Create a Xero invoice from an AgenticPay invoice. Existing invoices with the
 * same reference are left untouched.
 */
xeroRouter.post(
  '/invoices/sync',
  validate(accountingInvoiceSchema),
  asyncHandler(async (req, res) => {
    const result = await xeroService.syncInvoice(req.body);
    res.status(result.action === 'created' ? 201 : 200).json({
      success: true,
      result,
    });
  }),
);

/**
 * Record a payment against a Xero invoice reference.
 */
xeroRouter.post(
  '/payments',
  validate(accountingPaymentSchema),
  asyncHandler(async (req, res) => {
    const result = await xeroService.recordPayment(req.body);
    res.status(201).json({ success: true, result });
  }),
);
