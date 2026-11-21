// reconciliation.ts — Issue #628
// Mounted at /api/v1/reconciliation
//
// POST  /batches            — create + run a reconciliation batch for a tenant/period
// GET   /batches             — list batches for a tenant (optional date range)
// GET   /batches/:id         — batch detail (records/matches/exceptions)
// GET   /batches/:id/report  — reconciliation report for a batch
// GET   /exceptions          — list exceptions (filter by tenantId, status)
// PATCH /exceptions/:id      — update exception status/assignee/resolution note
// GET   /analytics           — reconciliation analytics (match rate, MTTR, trend)
// GET   /export              — CSV export of a batch report (query: batchId)

import { Router, Request } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import type { Result } from '../lib/result.js';
import {
  reconciliationService,
  type ExceptionStatus,
  type ExternalRecordInput,
} from '../services/payment-reconciliation/index.js';

export const paymentReconciliationRouter = Router();

const VALID_EXCEPTION_STATUSES: ExceptionStatus[] = ['open', 'investigating', 'resolved', 'written_off'];
const VALID_SOURCES = ['bank_statement', 'psp_settlement', 'onchain'] as const;

function paramId(req: Request): string {
  const { id } = req.params;
  return Array.isArray(id) ? id[0] : id;
}

function requireTenantId(req: Request): string {
  const tenantId = req.query.tenantId ?? req.body?.tenantId;
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new AppError(400, 'tenantId is required', 'VALIDATION_ERROR');
  }
  return tenantId;
}

function parseOptionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new AppError(400, `${field} must be a date string`, 'VALIDATION_ERROR');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, `${field} must be a valid date`, 'VALIDATION_ERROR');
  }
  return date;
}

function parseExternalRecords(body: unknown): ExternalRecordInput[] {
  const raw = (body as Record<string, unknown>)?.externalRecords;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new AppError(400, 'externalRecords must be an array', 'VALIDATION_ERROR');
  }
  return raw.map((item, i) => {
    if (typeof item !== 'object' || item === null) {
      throw new AppError(400, `externalRecords[${i}] must be an object`, 'VALIDATION_ERROR');
    }
    const r = item as Record<string, unknown>;
    if (typeof r.source !== 'string' || !VALID_SOURCES.includes(r.source as (typeof VALID_SOURCES)[number])) {
      throw new AppError(
        400,
        `externalRecords[${i}].source must be one of ${VALID_SOURCES.join(', ')}`,
        'VALIDATION_ERROR',
      );
    }
    if (typeof r.amount !== 'number') {
      throw new AppError(400, `externalRecords[${i}].amount must be a number`, 'VALIDATION_ERROR');
    }
    if (typeof r.currency !== 'string') {
      throw new AppError(400, `externalRecords[${i}].currency must be a string`, 'VALIDATION_ERROR');
    }
    if (typeof r.occurredAt !== 'string' && !(r.occurredAt instanceof Date)) {
      throw new AppError(400, `externalRecords[${i}].occurredAt is required`, 'VALIDATION_ERROR');
    }
    return {
      source: r.source as ExternalRecordInput['source'],
      externalRef: typeof r.externalRef === 'string' ? r.externalRef : null,
      amount: r.amount,
      currency: r.currency,
      occurredAt: r.occurredAt as string,
      metadata: (r.metadata as Record<string, unknown> | undefined) ?? null,
    };
  });
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new AppError(result.error.statusCode, result.error.message, result.error.code);
  }
  return result.value;
}

paymentReconciliationRouter.post(
  '/batches',
  asyncHandler(async (req, res) => {
    const { tenantId, periodStart, periodEnd } = req.body as Record<string, unknown>;
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      throw new AppError(400, 'tenantId is required', 'VALIDATION_ERROR');
    }
    if (typeof periodStart !== 'string' || typeof periodEnd !== 'string') {
      throw new AppError(400, 'periodStart and periodEnd are required', 'VALIDATION_ERROR');
    }
    const externalRecords = parseExternalRecords(req.body);

    const result = await reconciliationService.runBatch({ tenantId, periodStart, periodEnd, externalRecords });
    res.status(201).json({ data: unwrap(result) });
  }),
);

paymentReconciliationRouter.get(
  '/batches',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const from = parseOptionalDate(req.query.from, 'from');
    const to = parseOptionalDate(req.query.to, 'to');
    const result = await reconciliationService.listBatches({ tenantId, from, to });
    res.json({ data: unwrap(result) });
  }),
);

paymentReconciliationRouter.get(
  '/batches/:id/report',
  asyncHandler(async (req, res) => {
    const result = await reconciliationService.getBatchReport(paramId(req));
    res.json({ data: unwrap(result) });
  }),
);

paymentReconciliationRouter.get(
  '/batches/:id',
  asyncHandler(async (req, res) => {
    const result = await reconciliationService.getBatchDetail(paramId(req));
    res.json({ data: unwrap(result) });
  }),
);

paymentReconciliationRouter.get(
  '/exceptions',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const statusRaw = req.query.status;
    let status: ExceptionStatus | undefined;
    if (typeof statusRaw === 'string' && statusRaw.length > 0) {
      if (!VALID_EXCEPTION_STATUSES.includes(statusRaw as ExceptionStatus)) {
        throw new AppError(400, `status must be one of ${VALID_EXCEPTION_STATUSES.join(', ')}`, 'VALIDATION_ERROR');
      }
      status = statusRaw as ExceptionStatus;
    }
    const result = await reconciliationService.listExceptions({ tenantId, status });
    res.json({ data: unwrap(result) });
  }),
);

paymentReconciliationRouter.patch(
  '/exceptions/:id',
  asyncHandler(async (req, res) => {
    const { status, assignedTo, resolutionNote } = req.body as Record<string, unknown>;
    if (status !== undefined && !VALID_EXCEPTION_STATUSES.includes(status as ExceptionStatus)) {
      throw new AppError(400, `status must be one of ${VALID_EXCEPTION_STATUSES.join(', ')}`, 'VALIDATION_ERROR');
    }
    if (assignedTo !== undefined && assignedTo !== null && typeof assignedTo !== 'string') {
      throw new AppError(400, 'assignedTo must be a string or null', 'VALIDATION_ERROR');
    }
    if (resolutionNote !== undefined && resolutionNote !== null && typeof resolutionNote !== 'string') {
      throw new AppError(400, 'resolutionNote must be a string or null', 'VALIDATION_ERROR');
    }

    const result = await reconciliationService.updateException(paramId(req), {
      status: status as ExceptionStatus | undefined,
      assignedTo: assignedTo as string | null | undefined,
      resolutionNote: resolutionNote as string | null | undefined,
    });
    res.json({ data: unwrap(result) });
  }),
);

paymentReconciliationRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const from = parseOptionalDate(req.query.from, 'from');
    const to = parseOptionalDate(req.query.to, 'to');
    const result = await reconciliationService.getAnalytics({ tenantId, from, to });
    res.json({ data: unwrap(result) });
  }),
);

paymentReconciliationRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    const batchId = req.query.batchId;
    if (typeof batchId !== 'string' || batchId.length === 0) {
      throw new AppError(400, 'batchId is required', 'VALIDATION_ERROR');
    }
    const report = unwrap(await reconciliationService.getBatchReport(batchId));
    const csv = reconciliationService.reportToCsv(report);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reconciliation-${batchId}.csv"`);
    res.send(csv);
  }),
);
