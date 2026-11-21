import { Router } from 'express';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { idempotency } from '../middleware/idempotency.js';
import { SUPPORTED_PAYOUT_ASSETS, payoutEngine } from '../services/payouts/payout-engine.js';
import type { PayoutApprover, PayoutApproverRole } from '../services/payouts/payout-engine.js';
import { payoutBatcher } from '../services/payouts/payout-batcher.js';
import type { ScheduledPayoutStatus, PayoutBatchStatus } from '../services/payouts/payout-batcher.js';
import { payoutAnomalyDetector } from '../services/payouts/payout-anomaly-detector.js';
import type { PayoutAnomalyConfig, PayoutAnomalyStatus } from '../services/payouts/payout-anomaly-detector.js';
import { moneyMovementAuditLog } from '../audit/money-movement-audit.js';
import type { MoneyMovementOperation } from '../audit/money-movement-audit.js';

export const payoutsRouter = Router();

/**
 * Route-scoped ceilings, applied on top of the global `/api` limiter.
 *
 * They exist so payout traffic stays bounded even if the global limit is raised for
 * general API traffic: `evaluate` and `retries` fan out to the settlement rail, and the
 * approval endpoints move money.
 */
const PAYOUT_RATE_LIMIT_WINDOW_MS = 60_000;
const PAYOUT_RATE_LIMIT_MAX = 120;
const PAYOUT_DECISION_RATE_LIMIT_MAX = 30;

const payoutLimiter = rateLimit({
  windowMs: PAYOUT_RATE_LIMIT_WINDOW_MS,
  max: PAYOUT_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'ERR_RATE_LIMIT_EXCEEDED', message: 'Too many payout requests' },
    });
  },
});

/** Approval decisions are rarer than reads, so they get their own tighter ceiling. */
const payoutDecisionLimiter = rateLimit({
  windowMs: PAYOUT_RATE_LIMIT_WINDOW_MS,
  max: PAYOUT_DECISION_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'ERR_RATE_LIMIT_EXCEEDED', message: 'Too many payout decisions' },
    });
  },
});

payoutsRouter.use(payoutLimiter);

const SUPPORTED_ASSETS: readonly string[] = SUPPORTED_PAYOUT_ASSETS;
const SCHEDULE_TYPES = ['daily', 'weekly', 'monthly', 'threshold'] as const;
const APPROVER_ROLES: readonly PayoutApproverRole[] = ['finance_approver', 'admin'];

const MAX_ID_LENGTH = 128;

/** Every batch is capped here as well as in the engine, so the route cannot be used to bypass it. */
const MAX_PAYOUT_AMOUNT = 1_000_000;

interface Principal {
  id: string;
  role: PayoutApproverRole;
}

function readPrincipal(req: Request): Principal | undefined {
  const id = req.user?.id ?? req.headers['x-actor-id'];
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) return undefined;
  const role = req.user?.role ?? req.headers['x-actor-role'];
  if (typeof role !== 'string' || !APPROVER_ROLES.includes(role as PayoutApproverRole)) return undefined;
  return { id, role: role as PayoutApproverRole };
}

/**
 * Every payout route requires an authenticated principal holding an approver role.
 * The check runs before any lookup, so an unauthenticated caller cannot use the status
 * code to probe which batch ids exist.
 */
function requireApprover(req: Request): Principal {
  const principal = readPrincipal(req);
  if (!principal) {
    throw new AppError(401, 'Authentication with an approver role is required', 'UNAUTHORIZED');
  }
  return principal;
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new AppError(400, `${field} is required`, 'VALIDATION_ERROR');
  }
  return value;
}

function requireAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new AppError(400, 'amount must be a positive finite number', 'VALIDATION_ERROR');
  }
  if (value > MAX_PAYOUT_AMOUNT) {
    throw new AppError(400, `amount must not exceed ${MAX_PAYOUT_AMOUNT}`, 'VALIDATION_ERROR');
  }
  return value;
}

function toApprover(principal: Principal): PayoutApprover {
  return { id: principal.id, role: principal.role };
}

/**
 * Wraps the engine's error codes in HTTP responses. The engine throws bare sentinel
 * strings so it stays transport-agnostic; nothing internal (stack, rail response) leaks.
 */
function asHttpError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = error instanceof Error ? error.message.split(':')[0] : 'PAYOUT_ERROR';

  const status =
    code === 'PAYOUT_APPROVER_FORBIDDEN' ? 403 : code === 'PAYOUT_ANOMALY_REVIEW_PENDING' ? 409 : 400;
  const message =
    code === 'PAYOUT_ANOMALY_REVIEW_PENDING'
      ? 'Batch has anomaly flags awaiting review'
      : code === 'UNSUPPORTED_PAYOUT_ASSET'
      ? `preferredAsset must be one of: ${SUPPORTED_ASSETS.join(', ')}`
      : code === 'PAYOUT_APPROVER_FORBIDDEN'
        ? 'Insufficient permissions for this action'
        : code === 'PAYOUT_AMOUNT_EXCEEDED'
          ? `amount must not exceed ${MAX_PAYOUT_AMOUNT}`
          : 'Invalid payout request';

  return new AppError(status, message, code);
}

// ── Schedules ────────────────────────────────────────────────────────────────

payoutsRouter.put(
  '/schedules/:merchantId',
  idempotency(),
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const merchantId = requireId(req.params.merchantId, 'merchantId');
    const { scheduleType, thresholdAmount, preferredAsset, autoApproveLimit } = req.body ?? {};

    if (!SCHEDULE_TYPES.includes(scheduleType)) {
      throw new AppError(400, `scheduleType must be one of: ${SCHEDULE_TYPES.join(', ')}`, 'VALIDATION_ERROR');
    }
    if (typeof preferredAsset !== 'string' || !SUPPORTED_ASSETS.includes(preferredAsset)) {
      throw new AppError(
        400,
        `preferredAsset must be one of: ${SUPPORTED_ASSETS.join(', ')}`,
        'VALIDATION_ERROR',
      );
    }
    if (typeof autoApproveLimit !== 'number' || !Number.isFinite(autoApproveLimit) || autoApproveLimit < 0) {
      throw new AppError(400, 'autoApproveLimit must be a non-negative finite number', 'VALIDATION_ERROR');
    }
    if (scheduleType === 'threshold') {
      if (typeof thresholdAmount !== 'number' || !Number.isFinite(thresholdAmount) || thresholdAmount <= 0) {
        throw new AppError(400, 'thresholdAmount must be a positive number for threshold schedules', 'VALIDATION_ERROR');
      }
    } else if (thresholdAmount !== undefined) {
      throw new AppError(400, 'thresholdAmount only applies to threshold schedules', 'VALIDATION_ERROR');
    }

    const engine = payoutEngine;
    engine.configureSchedule({
      id: `sch_${merchantId}`,
      merchantId,
      scheduleType,
      ...(thresholdAmount !== undefined ? { thresholdAmount } : {}),
      preferredAsset,
      autoApproveLimit,
    });

    res.json({ data: { merchantId, scheduleType, thresholdAmount, preferredAsset, autoApproveLimit } });
  }),
);

payoutsRouter.delete(
  '/schedules/:merchantId',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const merchantId = requireId(req.params.merchantId, 'merchantId');
    payoutEngine.removeSchedule(merchantId);
    res.status(204).send();
  }),
);

// ── Balances ─────────────────────────────────────────────────────────────────

payoutsRouter.post(
  '/balances/:merchantId',
  idempotency(),
  asyncHandler(async (req, res) => {
    const principal = requireApprover(req);
    const merchantId = requireId(req.params.merchantId, 'merchantId');
    const amount = requireAmount(req.body?.amount);

    payoutEngine.setPendingAmount(merchantId, amount, principal.id);
    res.json({ data: { merchantId, pendingAmount: payoutEngine.getPendingAmount(merchantId) } });
  }),
);

payoutsRouter.get(
  '/balances/:merchantId',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const merchantId = requireId(req.params.merchantId, 'merchantId');
    res.json({ data: { merchantId, pendingAmount: payoutEngine.getPendingAmount(merchantId) } });
  }),
);

// ── Lifecycle ────────────────────────────────────────────────────────────────

payoutsRouter.post(
  '/evaluate',
  idempotency(),
  asyncHandler(async (req, res) => {
    requireApprover(req);
    try {
      const batches = await payoutEngine.evaluatePayouts();
      res.json({ data: batches, count: batches.length });
    } catch (error) {
      throw asHttpError(error);
    }
  }),
);

payoutsRouter.post(
  '/retries',
  idempotency(),
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const batches = await payoutEngine.retryDueBatches();
    res.json({ data: batches, count: batches.length });
  }),
);

payoutsRouter.post(
  '/:batchId/approve',
  idempotency(),
  payoutDecisionLimiter,
  asyncHandler(async (req, res) => {
const approver = toApprover(requireApprover(req));
    const batchId = requireId(req.params.batchId, 'batchId');
    try {
      const approved = await payoutEngine.approveManualPayout(batchId, approver);
      if (!approved) throw new AppError(409, 'Batch is not awaiting approval', 'INVALID_PAYOUT_STATE');
      res.json({ data: payoutEngine.getBatch(batchId) });
    } catch (error) {
      throw asHttpError(error);
    }
  }),
);

payoutsRouter.post(
  '/:batchId/reject',
  idempotency(),
  payoutDecisionLimiter,
  asyncHandler(async (req, res) => {
const approver = toApprover(requireApprover(req));
    const batchId = requireId(req.params.batchId, 'batchId');
    try {
      const rejected = await payoutEngine.rejectManualPayout(batchId, approver);
      if (!rejected) throw new AppError(409, 'Batch is not awaiting approval', 'INVALID_PAYOUT_STATE');
      res.json({ data: payoutEngine.getBatch(batchId) });
    } catch (error) {
      throw asHttpError(error);
    }
  }),
);

payoutsRouter.post(
  '/:batchId/retry',
  idempotency(),
  payoutDecisionLimiter,
  asyncHandler(async (req, res) => {
const approver = toApprover(requireApprover(req));
    const batchId = requireId(req.params.batchId, 'batchId');
    try {
      const retried = await payoutEngine.retryFailedBatch(batchId, approver);
      if (!retried) throw new AppError(409, 'Batch is not retryable', 'INVALID_PAYOUT_STATE');
      res.json({ data: payoutEngine.getBatch(batchId) });
    } catch (error) {
      throw asHttpError(error);
    }
  }),
);

payoutsRouter.post(
  '/:batchId/release',
  idempotency(),
  payoutDecisionLimiter,
  asyncHandler(async (req, res) => {
const approver = toApprover(requireApprover(req));
    const batchId = requireId(req.params.batchId, 'batchId');
    try {
      const released = await payoutEngine.releaseReservedFunds(batchId, approver);
      if (!released) throw new AppError(409, 'Batch has no releasable reservation', 'INVALID_PAYOUT_STATE');
      res.json({ data: payoutEngine.getBatch(batchId) });
    } catch (error) {
      throw asHttpError(error);
    }
  }),
);

// ── Scheduled & batched payouts (#1008) ─────────────────────────────────────

const SCHEDULED_STATUSES: readonly ScheduledPayoutStatus[] = ['scheduled', 'held', 'batched', 'paid', 'failed', 'cancelled'];
const BATCH_STATUSES: readonly PayoutBatchStatus[] = ['executing', 'completed', 'failed'];

/** Maps batcher/detector sentinel errors to client errors without leaking internals. */
function asValidationError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = error instanceof Error ? error.message.split(':')[0] : 'PAYOUT_ERROR';
  if (code === 'PAYOUT_ANOMALY_NOT_FOUND') return new AppError(404, 'Anomaly flag not found', 'NOT_FOUND');
  if (code === 'PAYOUT_ANOMALY_ALREADY_REVIEWED') {
    return new AppError(409, 'Anomaly flag has already been reviewed', 'ALREADY_REVIEWED');
  }
  if (code === 'IDEMPOTENCY_KEY_REUSE_MISMATCH') {
    return new AppError(409, 'Idempotency-Key was reused with a different request body', code);
  }
  if (!/^[A-Z_]+$/.test(code)) return new AppError(400, 'Invalid request', 'VALIDATION_ERROR');
  return new AppError(400, code.toLowerCase().replace(/_/g, ' '), code);
}

function optionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const date = typeof value === 'string' ? new Date(value) : undefined;
  if (!date || Number.isNaN(date.getTime())) {
    throw new AppError(400, `${field} must be an ISO-8601 timestamp`, 'VALIDATION_ERROR');
  }
  return date;
}

payoutsRouter.post(
  '/scheduled',
  idempotency(),
  asyncHandler(async (req, res) => {
    const principal = requireApprover(req);
    const { merchantId, recipient, amount, asset, scheduledFor, provider, reference } = req.body ?? {};
    requireAmount(amount);
    if (typeof asset !== 'string' || !SUPPORTED_ASSETS.includes(asset)) {
      throw new AppError(400, `asset must be one of: ${SUPPORTED_ASSETS.join(', ')}`, 'VALIDATION_ERROR');
    }
    // The service-level idempotency store (#1005) outlives the middleware cache; pass
    // the header through so a retry after an eviction still returns the original payout.
    const idempotencyKey =
      (req.get('Idempotency-Key') as string | undefined) ?? (req.get('X-Idempotency-Key') as string | undefined);
    try {
      const payout = payoutBatcher.schedule({
        merchantId: requireId(merchantId, 'merchantId'),
        recipient: requireId(recipient, 'recipient'),
        amount,
        asset,
        scheduledFor: optionalDate(scheduledFor, 'scheduledFor'),
        ...(provider !== undefined ? { provider } : {}),
        ...(reference !== undefined ? { reference } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        actorId: principal.id,
      });
      res.status(201).json({ data: payout });
    } catch (error) {
      throw asValidationError(error);
    }
  }),
);

payoutsRouter.get(
  '/scheduled',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status && !SCHEDULED_STATUSES.includes(status as ScheduledPayoutStatus)) {
      throw new AppError(400, `status must be one of: ${SCHEDULED_STATUSES.join(', ')}`, 'VALIDATION_ERROR');
    }
    const data = payoutBatcher.listPayouts({ merchantId, status: status as ScheduledPayoutStatus | undefined });
    res.json({ data, count: data.length });
  }),
);

payoutsRouter.delete(
  '/scheduled/:payoutId',
  asyncHandler(async (req, res) => {
    const principal = requireApprover(req);
    const payoutId = requireId(req.params.payoutId, 'payoutId');
    if (!payoutBatcher.cancel(payoutId, principal.id)) {
      throw new AppError(409, 'Payout is not cancellable', 'INVALID_PAYOUT_STATE');
    }
    res.json({ data: payoutBatcher.getPayout(payoutId) });
  }),
);

payoutsRouter.post(
  '/scheduled/run',
  idempotency(),
  payoutDecisionLimiter,
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const report = await payoutBatcher.runDue();
    if (!report) throw new AppError(409, 'A batch run is already in progress', 'BATCH_RUN_IN_PROGRESS');
    res.json({ data: report });
  }),
);

payoutsRouter.get(
  '/batches',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status && !BATCH_STATUSES.includes(status as PayoutBatchStatus)) {
      throw new AppError(400, `status must be one of: ${BATCH_STATUSES.join(', ')}`, 'VALIDATION_ERROR');
    }
    const data = payoutBatcher.listBatchReports({ status: status as PayoutBatchStatus | undefined });
    res.json({ data, count: data.length });
  }),
);

payoutsRouter.get(
  '/batches/runs/:runId',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const report = payoutBatcher.getRunReport(requireId(req.params.runId, 'runId'));
    if (!report) throw new AppError(404, 'Batch run not found', 'NOT_FOUND');
    res.json({ data: report });
  }),
);

payoutsRouter.get(
  '/batches/:batchId',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const report = payoutBatcher.getBatchReport(requireId(req.params.batchId, 'batchId'));
    if (!report) throw new AppError(404, 'Payout batch not found', 'NOT_FOUND');
    res.json({ data: report });
  }),
);

// ── Anomaly review (#1013) ───────────────────────────────────────────────────

const ANOMALY_STATUSES: readonly PayoutAnomalyStatus[] = ['open', 'confirmed', 'false_positive'];
const ANOMALY_CONFIG_FIELDS: readonly (keyof PayoutAnomalyConfig)[] = [
  'enabled',
  'singlePayoutThreshold',
  'velocityWindowMs',
  'velocityMaxCount',
  'velocityMaxAmount',
  'baselineMultiplier',
  'baselineMinSamples',
  'baselineSampleSize',
];

payoutsRouter.get(
  '/anomalies',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status && !ANOMALY_STATUSES.includes(status as PayoutAnomalyStatus)) {
      throw new AppError(400, `status must be one of: ${ANOMALY_STATUSES.join(', ')}`, 'VALIDATION_ERROR');
    }
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    const data = payoutAnomalyDetector.listFlags({ status: status as PayoutAnomalyStatus | undefined, merchantId });
    res.json({ data, count: data.length });
  }),
);

payoutsRouter.get(
  '/anomalies/config',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    res.json({ data: payoutAnomalyDetector.getConfig() });
  }),
);

payoutsRouter.put(
  '/anomalies/config',
  payoutDecisionLimiter,
  asyncHandler(async (req, res) => {
    const principal = requireApprover(req);
    // Thresholds gate fraud review, so only admins may loosen or tighten them.
    if (principal.role !== 'admin') {
      throw new AppError(403, 'Insufficient permissions for this action', 'PAYOUT_APPROVER_FORBIDDEN');
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const unknown = Object.keys(body).filter((key) => !ANOMALY_CONFIG_FIELDS.includes(key as keyof PayoutAnomalyConfig));
    if (unknown.length > 0) {
      throw new AppError(400, `Unknown config fields: ${unknown.join(', ')}`, 'VALIDATION_ERROR');
    }
    try {
      res.json({ data: payoutAnomalyDetector.updateConfig(body as Partial<PayoutAnomalyConfig>) });
    } catch (error) {
      throw asValidationError(error);
    }
  }),
);

payoutsRouter.post(
  '/anomalies/:flagId/review',
  idempotency(),
  payoutDecisionLimiter,
  asyncHandler(async (req, res) => {
    const principal = requireApprover(req);
    const flagId = requireId(req.params.flagId, 'flagId');
    const { decision, note, suppressForMs } = req.body ?? {};
    if (decision !== 'confirmed' && decision !== 'false_positive') {
      throw new AppError(400, 'decision must be one of: confirmed, false_positive', 'VALIDATION_ERROR');
    }
    if (note !== undefined && (typeof note !== 'string' || note.length > 1_000)) {
      throw new AppError(400, 'note must be a string of at most 1000 characters', 'VALIDATION_ERROR');
    }
    if (suppressForMs !== undefined && (decision !== 'false_positive' || typeof suppressForMs !== 'number')) {
      throw new AppError(400, 'suppressForMs only applies to false_positive decisions', 'VALIDATION_ERROR');
    }
    try {
      const flag = payoutAnomalyDetector.review(flagId, {
        reviewerId: principal.id,
        decision,
        ...(note !== undefined ? { note } : {}),
        ...(suppressForMs !== undefined ? { suppressForMs } : {}),
      });
      res.json({ data: flag });
    } catch (error) {
      throw asValidationError(error);
    }
  }),
);

// ── Money-movement audit (#1011) ─────────────────────────────────────────────

payoutsRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const q = req.query;
    const text = (value: unknown, field: string): string | undefined => {
      if (value === undefined) return undefined;
      if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
        throw new AppError(400, `${field} is invalid`, 'VALIDATION_ERROR');
      }
      return value;
    };
    const num = (value: unknown, field: string): number | undefined => {
      if (value === undefined) return undefined;
      const parsed = Number(value);
      if (typeof value !== 'string' || !Number.isFinite(parsed) || parsed < 0) {
        throw new AppError(400, `${field} must be a non-negative number`, 'VALIDATION_ERROR');
      }
      return parsed;
    };
    const operation = text(q.operation, 'operation');

    const result = moneyMovementAuditLog.query({
      actor: text(q.actor, 'actor'),
      merchantId: text(q.merchantId, 'merchantId'),
      reference: text(q.reference, 'reference'),
      asset: text(q.asset, 'asset'),
      ...(operation ? { operation: operation.split(',') as MoneyMovementOperation[] } : {}),
      minAmount: num(q.minAmount, 'minAmount'),
      maxAmount: num(q.maxAmount, 'maxAmount'),
      from: optionalDate(q.from, 'from'),
      to: optionalDate(q.to, 'to'),
      limit: num(q.limit, 'limit'),
      offset: num(q.offset, 'offset'),
    });
    res.json({ data: result.records, total: result.total, totalAmountByAsset: result.totalAmountByAsset });
  }),
);

payoutsRouter.get(
  '/audit/verify',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    res.json({ data: await moneyMovementAuditLog.verify() });
  }),
);

// ── Reads ────────────────────────────────────────────────────────────────────

payoutsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    if (merchantId && merchantId.length > MAX_ID_LENGTH) {
      throw new AppError(400, 'merchantId is too long', 'VALIDATION_ERROR');
    }
    res.json({ data: payoutEngine.getPayoutHistory(merchantId) });
  }),
);

payoutsRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    res.json({ data: payoutEngine.getStats() });
  }),
);

payoutsRouter.get(
  '/:batchId',
  asyncHandler(async (req, res) => {
    requireApprover(req);
    const batchId = requireId(req.params.batchId, 'batchId');
    const batch = payoutEngine.getBatch(batchId);
    if (!batch) throw new AppError(404, 'Payout batch not found', 'NOT_FOUND');
    res.json({ data: { ...batch, auditTrail: payoutEngine.getAuditTrail(batchId) } });
  }),
);