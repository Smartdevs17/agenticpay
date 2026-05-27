// Tax report API routes — Issue #351
// GET  /api/v1/tax/summary   — tax-year summary (gross/net volume)
// GET  /api/v1/tax/1099-k    — US 1099-K form
// GET  /api/v1/tax/vat       — VAT report for a jurisdiction
// GET  /api/v1/tax/nexus     — multi-jurisdiction economic-nexus detection
// GET  /api/v1/tax/export    — CSV export (summary | 1099-k)
// POST /api/v1/tax/track     — ingest a taxable transaction

import { Router, Request } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { taxReportService } from '../services/tax-reports.js';

export const taxRouter = Router();

function requireMerchantId(req: Request): string {
  const merchantId = req.query.merchantId ?? req.body?.merchantId;
  if (typeof merchantId !== 'string' || merchantId.length === 0) {
    throw new AppError(400, 'merchantId is required', 'VALIDATION_ERROR');
  }
  return merchantId;
}

function parseYear(req: Request): number {
  const raw = req.query.year;
  if (typeof raw === 'string') {
    const year = parseInt(raw, 10);
    if (!Number.isNaN(year) && year >= 2000 && year <= 2100) {
      return year;
    }
    throw new AppError(400, 'year must be between 2000 and 2100', 'VALIDATION_ERROR');
  }
  return new Date().getUTCFullYear();
}

taxRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const merchantId = requireMerchantId(req);
    const reportingCurrency =
      typeof req.query.reportingCurrency === 'string' ? req.query.reportingCurrency : undefined;
    res.json({ data: taxReportService.getYearSummary(merchantId, parseYear(req), { reportingCurrency }) });
  })
);

taxRouter.get(
  '/1099-k',
  asyncHandler(async (req, res) => {
    const merchantId = requireMerchantId(req);
    res.json({ data: taxReportService.generate1099K(merchantId, parseYear(req)) });
  })
);

taxRouter.get(
  '/vat',
  asyncHandler(async (req, res) => {
    const merchantId = requireMerchantId(req);
    const jurisdiction = req.query.jurisdiction;
    const rate = Number(req.query.rate);
    if (typeof jurisdiction !== 'string' || jurisdiction.length === 0) {
      throw new AppError(400, 'jurisdiction is required', 'VALIDATION_ERROR');
    }
    if (Number.isNaN(rate)) {
      throw new AppError(400, 'rate is required (fraction, e.g. 0.2)', 'VALIDATION_ERROR');
    }
    res.json({
      data: taxReportService.generateVatReport(merchantId, parseYear(req), {
        jurisdiction,
        rate,
        amountsIncludeVat: String(req.query.amountsIncludeVat).toLowerCase() === 'true',
      }),
    });
  })
);

taxRouter.get(
  '/nexus',
  asyncHandler(async (req, res) => {
    const merchantId = requireMerchantId(req);
    const amount = req.query.amount ? Number(req.query.amount) : undefined;
    const transactions = req.query.transactions ? Number(req.query.transactions) : undefined;
    res.json({
      data: taxReportService.detectNexus(merchantId, parseYear(req), { amount, transactions }),
    });
  })
);

taxRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    const merchantId = requireMerchantId(req);
    const year = parseYear(req);
    const type = req.query.type === '1099-k' ? '1099-k' : 'summary';

    const csv =
      type === '1099-k'
        ? taxReportService.form1099KToCsv(taxReportService.generate1099K(merchantId, year))
        : taxReportService.summaryToCsv(taxReportService.getYearSummary(merchantId, year));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tax-${type}-${merchantId}-${year}.csv"`
    );
    res.send(csv);
  })
);

taxRouter.post(
  '/track',
  asyncHandler(async (req, res) => {
    const merchantId = requireMerchantId(req);
    const { id, amount, currency, jurisdiction, type, timestamp } = req.body as Record<string, unknown>;

    if (
      typeof id !== 'string' ||
      typeof amount !== 'number' ||
      amount <= 0 ||
      typeof currency !== 'string' ||
      typeof jurisdiction !== 'string' ||
      (type !== 'sale' && type !== 'refund')
    ) {
      throw new AppError(400, 'Invalid taxable transaction payload', 'VALIDATION_ERROR');
    }

    taxReportService.recordTransaction({
      id,
      merchantId,
      amount,
      currency,
      jurisdiction,
      type,
      timestamp: typeof timestamp === 'string' ? new Date(timestamp) : new Date(),
    });

    res.status(201).json({ ok: true });
  })
);
