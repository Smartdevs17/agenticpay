import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  accountingInvoiceSchema,
  accountingPaymentSchema,
} from '../integrations/accounting/types.js';
import { quickBooksService } from '../integrations/quickbooks/index.js';

export const quickBooksRouter = Router();

quickBooksRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const configured = quickBooksService.isConfigured();
    const reachable = configured ? await quickBooksService.ping() : false;
    res.json({ configured, reachable });
  }),
);

/**
 * Create a QuickBooks invoice from an AgenticPay invoice. Invoices with the
 * same DocNumber are left untouched.
 */
quickBooksRouter.post(
  '/invoices/sync',
  validate(accountingInvoiceSchema),
  asyncHandler(async (req, res) => {
    const result = await quickBooksService.syncInvoice(req.body);
    res.status(result.action === 'created' ? 201 : 200).json({
      success: true,
      result,
    });
  }),
);

/**
 * Record a payment against a QuickBooks invoice.
 */
quickBooksRouter.post(
  '/payments/sync',
  validate(accountingPaymentSchema),
  asyncHandler(async (req, res) => {
    const result = await quickBooksService.recordPayment(req.body);
    res.status(201).json({ success: true, result });
  }),
);
