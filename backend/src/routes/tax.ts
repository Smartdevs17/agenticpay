// Tax report API routes — Issue #351
// GET  /api/v1/tax/summary   — tax-year summary (gross/net volume)
// GET  /api/v1/tax/1099-k    — US 1099-K form
// GET  /api/v1/tax/vat       — VAT report for a jurisdiction
// GET  /api/v1/tax/nexus     — multi-jurisdiction economic-nexus detection
// GET  /api/v1/tax/export    — CSV export (summary | 1099-k)
// POST /api/v1/tax/track     — ingest a taxable transaction
//
// Jurisdiction-aware tax rule engine routes — Issue #627
// POST   /api/v1/tax/jurisdiction-rules       — create a jurisdiction tax rule
// GET    /api/v1/tax/jurisdiction-rules       — list/filter jurisdiction tax rules
// PATCH  /api/v1/tax/jurisdiction-rules/:id   — update/deactivate a rule
// POST   /api/v1/tax/calculate                — automated tax calculation for a payment/amount
// GET    /api/v1/tax/reporting/:jurisdiction  — tax reporting for one jurisdiction
// GET    /api/v1/tax/compliance               — compliance check findings
// POST   /api/v1/tax/exemptions               — create a tax exemption
// GET    /api/v1/tax/exemptions               — list tax exemptions
// DELETE /api/v1/tax/exemptions/:id           — revoke a tax exemption
// GET    /api/v1/tax/audit-trail              — tax calculation audit trail

import { Router, Request } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { taxReportService } from '../services/tax-reports.js';
import { taxRuleEngine, TaxRuleType } from '../services/tax/index.js';
import type { Result } from '../lib/result.js';

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

// ─── Jurisdiction-aware tax rule engine — Issue #627 ────────────────────────

function requireTenantId(req: Request): string {
  const tenantId = req.query.tenantId ?? req.body?.tenantId;
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new AppError(400, 'tenantId is required', 'VALIDATION_ERROR');
  }
  return tenantId;
}

const VALID_RULE_TYPES: TaxRuleType[] = ['vat', 'gst', 'sales_tax', 'withholding'];

function parseRuleType(value: unknown): TaxRuleType | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && (VALID_RULE_TYPES as string[]).includes(value)) {
    return value as TaxRuleType;
  }
  throw new AppError(400, `ruleType must be one of ${VALID_RULE_TYPES.join(', ')}`, 'VALIDATION_ERROR');
}

function parseDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new AppError(400, `${field} must be an ISO date string`, 'VALIDATION_ERROR');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, `${field} is not a valid date`, 'VALIDATION_ERROR');
  }
  return date;
}

/** Unwraps a service Result, translating a failure into the matching AppError. */
function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new AppError(result.error.statusCode, result.error.message, result.error.code, result.error.details);
}

taxRouter.post(
  '/jurisdiction-rules',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const { jurisdiction, name, rate } = body;
    const ruleType = parseRuleType(body.ruleType);

    if (typeof jurisdiction !== 'string' || jurisdiction.length === 0) {
      throw new AppError(400, 'jurisdiction is required', 'VALIDATION_ERROR');
    }
    if (typeof name !== 'string' || name.length === 0) {
      throw new AppError(400, 'name is required', 'VALIDATION_ERROR');
    }
    if (!ruleType) {
      throw new AppError(400, 'ruleType is required (vat | gst | sales_tax | withholding)', 'VALIDATION_ERROR');
    }
    if (typeof rate !== 'number' || Number.isNaN(rate)) {
      throw new AppError(400, 'rate is required (fraction, e.g. 0.2)', 'VALIDATION_ERROR');
    }

    const result = await taxRuleEngine.createRule({
      jurisdiction,
      name,
      ruleType,
      rate,
      appliesAbove: typeof body.appliesAbove === 'number' ? body.appliesAbove : null,
      active: typeof body.active === 'boolean' ? body.active : undefined,
      effectiveFrom: parseDate(body.effectiveFrom, 'effectiveFrom'),
      effectiveTo: parseDate(body.effectiveTo, 'effectiveTo'),
      metadata: (body.metadata as Record<string, unknown> | undefined) ?? null,
    });
    res.status(201).json({ data: unwrap(result) });
  })
);

taxRouter.get(
  '/jurisdiction-rules',
  asyncHandler(async (req, res) => {
    const jurisdiction = typeof req.query.jurisdiction === 'string' ? req.query.jurisdiction : undefined;
    const ruleType = parseRuleType(req.query.ruleType);
    const activeOnly = String(req.query.activeOnly).toLowerCase() === 'true';
    const at = parseDate(req.query.at, 'at');

    const result = await taxRuleEngine.listRules({ jurisdiction, ruleType, activeOnly, at });
    res.json({ data: unwrap(result) });
  })
);

taxRouter.patch(
  '/jurisdiction-rules/:id',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const result = await taxRuleEngine.updateRule(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      ruleType: parseRuleType(body.ruleType),
      rate: typeof body.rate === 'number' ? body.rate : undefined,
      appliesAbove:
        body.appliesAbove === null ? null : typeof body.appliesAbove === 'number' ? body.appliesAbove : undefined,
      active: typeof body.active === 'boolean' ? body.active : undefined,
      effectiveFrom: parseDate(body.effectiveFrom, 'effectiveFrom'),
      effectiveTo: body.effectiveTo === null ? null : parseDate(body.effectiveTo, 'effectiveTo'),
      metadata: body.metadata === null ? null : (body.metadata as Record<string, unknown> | undefined),
    });
    res.json({ data: unwrap(result) });
  })
);

taxRouter.post(
  '/calculate',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const merchantId = requireMerchantId(req);
    const body = req.body as Record<string, unknown>;
    const { jurisdiction, amount, currency, paymentId } = body;

    if (typeof jurisdiction !== 'string' || jurisdiction.length === 0) {
      throw new AppError(400, 'jurisdiction is required', 'VALIDATION_ERROR');
    }
    if (typeof amount !== 'number' || Number.isNaN(amount) || amount < 0) {
      throw new AppError(400, 'amount is required and must be a non-negative number', 'VALIDATION_ERROR');
    }
    if (typeof currency !== 'string' || currency.length === 0) {
      throw new AppError(400, 'currency is required', 'VALIDATION_ERROR');
    }

    const result = await taxRuleEngine.calculate({
      tenantId,
      merchantId,
      jurisdiction,
      amount,
      currency,
      paymentId: typeof paymentId === 'string' ? paymentId : undefined,
      at: parseDate(body.at, 'at'),
    });
    res.json({ data: unwrap(result) });
  })
);

taxRouter.get(
  '/reporting/:jurisdiction',
  asyncHandler(async (req, res) => {
    const merchantId = requireMerchantId(req);
    const jurisdiction = Array.isArray(req.params.jurisdiction) ? req.params.jurisdiction[0] : req.params.jurisdiction;
    const year = parseYear(req);

    const summary = taxReportService.getYearSummary(merchantId, year);
    const breakdown = summary.byJurisdiction.find(
      (j) => j.jurisdiction.toUpperCase() === jurisdiction.toUpperCase()
    ) ?? { jurisdiction, gross: 0, refunds: 0, net: 0, count: 0 };

    const rulesResult = await taxRuleEngine.listRules({ jurisdiction, activeOnly: true, at: new Date() });
    const activeRules = rulesResult.ok ? rulesResult.value : [];

    res.json({
      data: {
        merchantId,
        jurisdiction,
        year,
        reportingCurrency: summary.reportingCurrency,
        breakdown,
        activeRules,
        warnings: summary.warnings,
        retention: summary.retention,
        generatedAt: summary.generatedAt,
      },
    });
  })
);

taxRouter.get(
  '/compliance',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const merchantId = requireMerchantId(req);
    const jurisdiction = typeof req.query.jurisdiction === 'string' ? req.query.jurisdiction : undefined;

    const result = await taxRuleEngine.checkCompliance({ tenantId, merchantId, jurisdiction });
    res.json({ data: unwrap(result) });
  })
);

taxRouter.post(
  '/exemptions',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const merchantId = requireMerchantId(req);
    const body = req.body as Record<string, unknown>;
    const { jurisdiction, reason, certificateId } = body;

    if (typeof jurisdiction !== 'string' || jurisdiction.length === 0) {
      throw new AppError(400, 'jurisdiction is required', 'VALIDATION_ERROR');
    }
    if (typeof reason !== 'string' || reason.length === 0) {
      throw new AppError(400, 'reason is required', 'VALIDATION_ERROR');
    }

    const result = await taxRuleEngine.createExemption({
      tenantId,
      merchantId,
      jurisdiction,
      reason,
      certificateId: typeof certificateId === 'string' ? certificateId : undefined,
      validFrom: parseDate(body.validFrom, 'validFrom'),
      validTo: parseDate(body.validTo, 'validTo'),
    });
    res.status(201).json({ data: unwrap(result) });
  })
);

taxRouter.get(
  '/exemptions',
  asyncHandler(async (req, res) => {
    const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    const jurisdiction = typeof req.query.jurisdiction === 'string' ? req.query.jurisdiction : undefined;
    const activeOnly = String(req.query.activeOnly).toLowerCase() === 'true';

    const result = await taxRuleEngine.listExemptions({ tenantId, merchantId, jurisdiction, activeOnly });
    res.json({ data: unwrap(result) });
  })
);

taxRouter.delete(
  '/exemptions/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await taxRuleEngine.revokeExemption(id);
    res.json({ data: unwrap(result) });
  })
);

taxRouter.get(
  '/audit-trail',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    const jurisdiction = typeof req.query.jurisdiction === 'string' ? req.query.jurisdiction : undefined;
    const since = parseDate(req.query.since, 'since');
    const until = parseDate(req.query.until, 'until');
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const result = await taxRuleEngine.getAuditTrail({
      tenantId,
      merchantId,
      jurisdiction,
      since,
      until,
      limit,
      offset,
    });
    res.json({ data: unwrap(result) });
  })
);
