import { Router } from 'express';
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
} from '../services/invoice.js';
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
