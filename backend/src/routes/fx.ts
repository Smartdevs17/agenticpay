// FX conversion API routes — Issue #626
// Mounted at /api/v1/fx (see backend/docs/FX_CONVERSION.md for the full guide)
//
// GET    /rates?base=&quote=              — current cached/fresh rate for a pair
// POST   /convert                         — { amount, base, quote } -> converted amount + rate metadata
// GET    /history?base=&quote=&since=&until= — historical cached rates for a pair
// POST   /alerts                          — create a threshold rate alert
// GET    /alerts?tenantId=&base=&quote=&activeOnly= — list alerts
// DELETE /alerts/:id                      — deactivate an alert

import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { fxService } from '../services/fx/index.js';
import type { FxAlertDirection } from '../services/fx/index.js';

export const fxRouter = Router();

function requireCurrency(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(400, `${field} is required`, 'VALIDATION_ERROR');
  }
  return value;
}

function parseOptionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new AppError(400, `${field} must be an ISO date string`, 'VALIDATION_ERROR');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, `${field} must be a valid ISO date string`, 'VALIDATION_ERROR');
  }
  return parsed;
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: { statusCode: number; message: string; code: string } }): T {
  if (!result.ok || result.value === undefined) {
    const error = result.error!;
    throw new AppError(error.statusCode, error.message, error.code);
  }
  return result.value;
}

fxRouter.get(
  '/rates',
  asyncHandler(async (req, res) => {
    const base = requireCurrency(req.query.base, 'base');
    const quote = requireCurrency(req.query.quote, 'quote');
    const result = await fxService.getRate(base, quote);
    res.json({ data: unwrap(result) });
  }),
);

fxRouter.post(
  '/convert',
  asyncHandler(async (req, res) => {
    const { amount, base, quote } = req.body as Record<string, unknown>;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new AppError(400, 'amount must be a finite number', 'VALIDATION_ERROR');
    }
    const baseCurrency = requireCurrency(base, 'base');
    const quoteCurrency = requireCurrency(quote, 'quote');

    const result = await fxService.convert(amount, baseCurrency, quoteCurrency);
    res.json({ data: unwrap(result) });
  }),
);

fxRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const base = requireCurrency(req.query.base, 'base');
    const quote = requireCurrency(req.query.quote, 'quote');
    const since = parseOptionalDate(req.query.since, 'since');
    const until = parseOptionalDate(req.query.until, 'until');

    const result = await fxService.getHistory(base, quote, { since, until });
    res.json({ data: unwrap(result) });
  }),
);

fxRouter.post(
  '/alerts',
  asyncHandler(async (req, res) => {
    const { tenantId, baseCurrency, quoteCurrency, thresholdPct, direction } = req.body as Record<string, unknown>;

    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      throw new AppError(400, 'tenantId is required', 'VALIDATION_ERROR');
    }
    const base = requireCurrency(baseCurrency, 'baseCurrency');
    const quote = requireCurrency(quoteCurrency, 'quoteCurrency');
    if (typeof thresholdPct !== 'number' || !Number.isFinite(thresholdPct) || thresholdPct <= 0) {
      throw new AppError(400, 'thresholdPct must be a positive number', 'VALIDATION_ERROR');
    }
    if (direction !== undefined && direction !== 'up' && direction !== 'down' && direction !== 'both') {
      throw new AppError(400, "direction must be one of 'up' | 'down' | 'both'", 'VALIDATION_ERROR');
    }

    const result = await fxService.createAlert({
      tenantId,
      baseCurrency: base,
      quoteCurrency: quote,
      thresholdPct,
      direction: direction as FxAlertDirection | undefined,
    });
    res.status(201).json({ data: unwrap(result) });
  }),
);

fxRouter.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const { tenantId, base, quote, activeOnly } = req.query as Record<string, string | undefined>;
    const result = await fxService.listAlerts({
      tenantId,
      baseCurrency: base,
      quoteCurrency: quote,
      activeOnly: activeOnly === 'true',
    });
    res.json({ data: unwrap(result) });
  }),
);

fxRouter.delete(
  '/alerts/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await fxService.deactivateAlert(id);
    res.json({ data: unwrap(result) });
  }),
);
