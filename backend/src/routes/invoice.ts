import { Router } from 'express';
import { z } from 'zod';
import { idempotency } from '../middleware/idempotency.js';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import {
  generateInvoice,
  getInvoice,
  listInvoices,
  getTaxRates,
  generateTaxReport,
  buildInvoicePdf,
  sendInvoiceEmail,
  updateInvoiceStatus,
  sendPaymentReminder,
  processOverdueInvoices,
  getInvoiceReminders,
} from '../services/invoice.js';
import type { InvoiceStatus } from '../services/invoice.js';
import { invoiceSchema, invoiceTaxReportSchema } from '../schemas/index.js';

export const invoiceRouter = Router();

invoiceRouter.post(
  '/generate',
  idempotency(),
  validate(invoiceSchema),
  asyncHandler(async (req, res) => {
    const { projectId, workDescription, hoursWorked, hourlyRate, merchantId, countryCode } = req.body;

    if (!projectId || !workDescription || !merchantId) {
      throw new AppError(400, 'Missing required fields', 'VALIDATION_ERROR');
    }

    const invoice = await generateInvoice({
      projectId,
      merchantId,
      workDescription,
      hoursWorked: hoursWorked || 0,
      hourlyRate: hourlyRate || 0,
      countryCode: countryCode || 'US',
    });

    res.status(201).json(invoice);
  })
);

invoiceRouter.get(
  '/tax-rates',
  asyncHandler(async (req, res) => {
    res.json(getTaxRates());
  })
);

invoiceRouter.post(
  '/tax-report',
  validate(invoiceTaxReportSchema),
  asyncHandler(async (req, res) => {
    const report = generateTaxReport(req.body);
    res.json(report);
  })
);

invoiceRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(listInvoices());
  })
);

invoiceRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const invoice = getInvoice(id);
    if (!invoice) {
      throw new AppError(404, 'Invoice not found', 'NOT_FOUND');
    }
    res.json(invoice);
  })
);

invoiceRouter.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const invoice = getInvoice(id);
    if (!invoice) {
      throw new AppError(404, 'Invoice not found', 'NOT_FOUND');
    }

    const pdf = buildInvoicePdf(invoice);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(pdf);
  })
);

// POST /:id/send — send invoice via email
const sendInvoiceSchema = z.object({
  recipientEmail: z.string().email(),
  recipientName: z.string().optional(),
});

invoiceRouter.post(
  '/:id/send',
  validate(sendInvoiceSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { recipientEmail, recipientName } = req.body;
    const result = await sendInvoiceEmail(id, recipientEmail, recipientName);
    if (!result.success && result.error === 'Invoice not found') {
      throw new AppError(404, 'Invoice not found', 'NOT_FOUND');
    }
    if (!result.success) {
      throw new AppError(500, result.error || 'Failed to send invoice', 'SEND_FAILED');
    }
    res.json({ ok: true, messageId: result.messageId });
  })
);

// PATCH /:id/status — update invoice status
const updateStatusSchema = z.object({
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']),
});

invoiceRouter.patch(
  '/:id/status',
  validate(updateStatusSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { status } = req.body as { status: InvoiceStatus };
    const invoice = updateInvoiceStatus(id, status);
    if (!invoice) throw new AppError(404, 'Invoice not found', 'NOT_FOUND');
    res.json(invoice);
  })
);

// POST /:id/remind — send payment reminder
invoiceRouter.post(
  '/:id/remind',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const reminder = sendPaymentReminder(id);
    if (!reminder) throw new AppError(400, 'No reminder needed or invoice not found', 'REMINDER_FAILED');
    res.json({ reminder });
  })
);

// GET /:id/reminders — get reminder history
invoiceRouter.get(
  '/:id/reminders',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const reminders = getInvoiceReminders(id);
    res.json({ reminders });
  })
);

// POST /process-overdue — process all overdue invoices
invoiceRouter.post(
  '/process-overdue',
  asyncHandler(async (_req, res) => {
    const reminders = processOverdueInvoices();
    res.json({ processed: reminders.length, reminders });
  })
);
