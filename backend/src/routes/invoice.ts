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
  reconvertInvoiceFxAtPayment,
  generateMultiCurrencyReport,
  registerMilestoneTrigger,
  getMilestoneTriggers,
  removeMilestoneTrigger,
  buildInvoiceAnalytics,
} from '../services/invoice.js';
import type { InvoiceStatus } from '../services/invoice.js';
import { invoiceSchema, invoiceTaxReportSchema } from '../schemas/index.js';

export const invoiceRouter = Router();

// Multi-currency generation (Issue #626) — a dedicated endpoint rather than
// extending `invoiceSchema` (shared across other in-flight work), since
// `validate()` strips any body field the schema doesn't declare. Locks the
// FX rate at generation time via `fxService`.
invoiceRouter.post(
  '/generate/multi-currency',
  idempotency(),
  asyncHandler(async (req, res) => {
    const { projectId, workDescription, hoursWorked, hourlyRate, merchantId, countryCode, presentmentCurrency } =
      req.body as Record<string, unknown>;

    if (typeof projectId !== 'string' || typeof workDescription !== 'string' || typeof merchantId !== 'string') {
      throw new AppError(400, 'projectId, workDescription and merchantId are required', 'VALIDATION_ERROR');
    }
    if (typeof presentmentCurrency !== 'string' || presentmentCurrency.trim().length === 0) {
      throw new AppError(400, 'presentmentCurrency is required', 'VALIDATION_ERROR');
    }

    const invoice = await generateInvoice({
      projectId,
      merchantId,
      workDescription,
      hoursWorked: typeof hoursWorked === 'number' ? hoursWorked : 0,
      hourlyRate: typeof hourlyRate === 'number' ? hourlyRate : 0,
      countryCode: typeof countryCode === 'string' ? countryCode : 'US',
      presentmentCurrency,
    });

    res.status(201).json({ data: invoice });
  })
);

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
  '/reporting/multi-currency',
  asyncHandler(async (req, res) => {
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    res.json({ data: generateMultiCurrencyReport({ merchantId }) });
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

// Locks (or re-locks, e.g. at payment time) the FX rate for a multi-currency
// invoice — the generation-time rate may have expired or moved by the time
// the invoice is actually paid. Body: { presentmentCurrency? } — falls back
// to the invoice's already-set presentmentCurrency if omitted.
invoiceRouter.post(
  '/:id/convert',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { presentmentCurrency } = req.body as Record<string, unknown>;

    if (presentmentCurrency !== undefined && typeof presentmentCurrency !== 'string') {
      throw new AppError(400, 'presentmentCurrency must be a string', 'VALIDATION_ERROR');
    }
    if (!getInvoice(id)) {
      throw new AppError(404, 'Invoice not found', 'NOT_FOUND');
    }

    try {
      const invoice = await reconvertInvoiceFxAtPayment(id, presentmentCurrency);
      res.json({ data: invoice });
    } catch (err) {
      throw new AppError(400, err instanceof Error ? err.message : 'FX conversion failed', 'FX_CONVERSION_ERROR');
    }
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

// ── Milestone-Triggered Invoicing (Issue #636) ───────────────────────────────

const milestoneTriggerSchema = z.object({
  projectId: z.string().min(1),
  merchantId: z.string().min(1),
  countryCode: z.string().optional(),
  presentmentCurrency: z.string().optional(),
  autoSend: z.boolean().optional(),
  recipientEmail: z.string().email().optional(),
  recipientName: z.string().optional(),
});

invoiceRouter.post(
  '/milestone-trigger',
  validate(milestoneTriggerSchema),
  asyncHandler(async (req, res) => {
    const config = req.body;
    registerMilestoneTrigger(config);
    res.status(201).json({ ok: true, config });
  })
);

invoiceRouter.get(
  '/milestone-trigger/:projectId',
  asyncHandler(async (req, res) => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const triggers = getMilestoneTriggers(projectId);
    res.json({ triggers });
  })
);

invoiceRouter.delete(
  '/milestone-trigger/:projectId/:merchantId',
  asyncHandler(async (req, res) => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const merchantId = Array.isArray(req.params.merchantId) ? req.params.merchantId[0] : req.params.merchantId;
    const removed = removeMilestoneTrigger(projectId, merchantId);
    if (!removed) throw new AppError(404, 'Milestone trigger not found', 'NOT_FOUND');
    res.json({ ok: true });
  })
);

// ── Invoice Analytics (Issue #636) ───────────────────────────────────────────

invoiceRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    const analytics = buildInvoiceAnalytics(merchantId);
    res.json({ data: analytics });
  })
);

invoiceRouter.get(
  '/analytics/summary',
  asyncHandler(async (req, res) => {
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    const analytics = buildInvoiceAnalytics(merchantId);
    res.json({ data: analytics });
  })
);
