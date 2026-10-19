import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  accountingInvoiceSchema,
  accountingPaymentSchema,
} from '../integrations/accounting/types.js';
import { salesforceBillingService } from '../integrations/salesforce/index.js';

export const salesforceRouter = Router();

salesforceRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const configured = salesforceBillingService.isConfigured();
    const reachable = configured
      ? await salesforceBillingService.ping()
      : false;
    res.json({ configured, reachable });
  }),
);

/**
 * Create or update a Salesforce Billing invoice from an AgenticPay invoice.
 */
salesforceRouter.post(
  '/invoices/sync',
  validate(accountingInvoiceSchema),
  asyncHandler(async (req, res) => {
    const result = await salesforceBillingService.syncInvoice(req.body);
    res.status(result.action === 'created' ? 201 : 200).json({
      success: true,
      result,
    });
  }),
);

/**
 * Record a payment against a previously synced Salesforce Billing invoice.
 */
salesforceRouter.post(
  '/payments/sync',
  validate(accountingPaymentSchema),
  asyncHandler(async (req, res) => {
    const result = await salesforceBillingService.recordPayment(req.body);
    res.status(result.action === 'created' ? 201 : 200).json({
      success: true,
      result,
    });
  }),
);
