import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  approvePaymentSchema,
  bankWebhookSchema,
  batchPaymentSchema,
  confirmMicroDepositsSchema,
  initiateFiatPaymentSchema,
  verifyBankAccountSchema,
} from '../schemas/fiat-payments.js';
import {
  FiatPaymentMethod,
  FiatPaymentStatus,
  fiatPaymentsService,
} from '../services/fiat-payments.js';

export const fiatPaymentsRouter = Router();

fiatPaymentsRouter.post(
  '/bank-accounts/verify',
  validate(verifyBankAccountSchema),
  asyncHandler(async (req, res) => {
    const account = fiatPaymentsService.createBankAccount(req.body);
    res.status(201).json({ data: account });
  })
);

fiatPaymentsRouter.post(
  '/bank-accounts/:id/confirm-micro-deposits',
  validate(confirmMicroDepositsSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const account = fiatPaymentsService.confirmMicroDeposits(id, req.body.amountsInCents);

    if (!account) {
      throw new AppError(404, 'Bank account not found', 'NOT_FOUND');
    }

    if (account.status !== 'verified') {
      throw new AppError(400, 'Micro-deposit verification failed', 'BANK_VERIFICATION_FAILED', {
        bankAccountId: account.id,
      });
    }

    res.json({ data: account });
  })
);

fiatPaymentsRouter.get(
  '/bank-accounts/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const account = fiatPaymentsService.getBankAccount(id);
    if (!account) {
      throw new AppError(404, 'Bank account not found', 'NOT_FOUND');
    }
    res.json({ data: account });
  })
);

fiatPaymentsRouter.get(
  '/fees/estimate',
  asyncHandler(async (req, res) => {
    const method = String(req.query.method || '').toLowerCase() as FiatPaymentMethod;
    if (method !== 'ach' && method !== 'wire') {
      throw new AppError(400, 'method must be ach or wire', 'VALIDATION_ERROR');
    }

    const amount = Number(req.query.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError(400, 'amount must be a positive number', 'VALIDATION_ERROR');
    }

    const isInternational = String(req.query.international || 'false').toLowerCase() === 'true';
    const fee = fiatPaymentsService.calculateFee(method, amount, isInternational);
    res.json({ data: { method, amount, fee, isInternational } });
  })
);

fiatPaymentsRouter.post(
  '/payments',
  validate(initiateFiatPaymentSchema),
  asyncHandler(async (req, res) => {
    try {
      const payment = fiatPaymentsService.createPayment(req.body);
      res.status(201).json({ data: payment });
    } catch (error) {
      if (error instanceof Error && error.message === 'BANK_ACCOUNT_NOT_FOUND') {
        throw new AppError(404, 'Bank account not found', 'NOT_FOUND');
      }
      if (error instanceof Error && error.message === 'BANK_ACCOUNT_NOT_VERIFIED') {
        throw new AppError(400, 'Bank account must be verified before payment initiation', 'BANK_ACCOUNT_NOT_VERIFIED');
      }
      if (error instanceof Error && error.message === 'INTERNATIONAL_WIRE_REQUIRES_SWIFT') {
        throw new AppError(400, 'International wire requires swiftCode on recipient', 'VALIDATION_ERROR');
      }
      throw error;
    }
  })
);

fiatPaymentsRouter.post(
  '/payments/batch',
  validate(batchPaymentSchema),
  asyncHandler(async (req, res) => {
    const { reference, payments } = req.body;
    const batch = fiatPaymentsService.createBatch(reference, payments);
    res.status(201).json({ data: batch });
  })
);

fiatPaymentsRouter.post(
  '/payments/:id/approve',
  validate(approvePaymentSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const payment = fiatPaymentsService.approvePayment(id, req.body.approvedBy);
    if (!payment) {
      throw new AppError(404, 'Payment not found', 'NOT_FOUND');
    }
    res.json({ data: payment });
  })
);

fiatPaymentsRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const method = req.query.method ? String(req.query.method).toLowerCase() : undefined;
    const status = req.query.status ? String(req.query.status).toLowerCase() : undefined;
    const list = fiatPaymentsService.listPayments({
      method: method as FiatPaymentMethod | undefined,
      status: status as FiatPaymentStatus | undefined,
    });

    res.json({ data: list, count: list.length });
  })
);

fiatPaymentsRouter.get(
  '/payments/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const payment = fiatPaymentsService.getPayment(id);
    if (!payment) {
      throw new AppError(404, 'Payment not found', 'NOT_FOUND');
    }

    res.json({ data: payment, events: fiatPaymentsService.getPaymentEvents(id) });
  })
);

fiatPaymentsRouter.get(
  '/payments/:id/wire-instructions',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const payment = fiatPaymentsService.getPayment(id);
    if (!payment) {
      throw new AppError(404, 'Payment not found', 'NOT_FOUND');
    }
    if (payment.method !== 'wire') {
      throw new AppError(400, 'Wire instructions are only available for wire payments', 'VALIDATION_ERROR');
    }

    res.json({ data: { paymentId: payment.id, instructions: payment.wireInstructions, bankReference: payment.bankReference } });
  })
);

fiatPaymentsRouter.post(
  '/webhooks/bank-partner',
  validate(bankWebhookSchema),
  asyncHandler(async (req, res) => {
    const payment = fiatPaymentsService.handleWebhook(req.body);
    if (!payment) {
      throw new AppError(404, 'Payment not found', 'NOT_FOUND');
    }
    res.json({ data: payment });
  })
);

fiatPaymentsRouter.get(
  '/reconciliation/report',
  asyncHandler(async (req, res) => {
    const from = String(req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    const to = String(req.query.to || new Date().toISOString());

    if (Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) {
      throw new AppError(400, 'from/to must be valid ISO date values', 'VALIDATION_ERROR');
    }

    const report = fiatPaymentsService.getReconciliationReport(from, to);
    res.json({ data: report });
  })
);