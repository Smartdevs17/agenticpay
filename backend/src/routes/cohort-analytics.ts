// Subscription cohort analytics API routes — Issue #629
// Mounted at /api/v1/analytics/cohorts
//
// POST /api/v1/analytics/cohorts/track                        — ingest a subscription lifecycle event
// GET  /api/v1/analytics/cohorts                               — list cohorts + sizes
// GET  /api/v1/analytics/cohorts/:cohortMonth/retention        — retention curve
// GET  /api/v1/analytics/cohorts/:cohortMonth/revenue          — revenue cohort analysis
// GET  /api/v1/analytics/cohorts/:cohortMonth/churn            — churn cohort analysis
// POST /api/v1/analytics/cohorts/compare                       — { cohortMonths: string[] } side-by-side comparison
// GET  /api/v1/analytics/cohorts/:cohortMonth/export?kind=...  — CSV export (retention | revenue | churn)

import { Router, Request } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { cohortAnalyticsService, SubscriptionLifecycleEventType } from '../services/cohort-analytics.js';

export const cohortAnalyticsRouter = Router();

const LIFECYCLE_EVENTS: SubscriptionLifecycleEventType[] = ['started', 'renewed', 'cancelled', 'payment_failed'];
const COHORT_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function requireCohortMonth(req: Request): string {
  const { cohortMonth } = req.params;
  if (typeof cohortMonth !== 'string' || !COHORT_MONTH_RE.test(cohortMonth)) {
    throw new AppError(400, 'cohortMonth must be in YYYY-MM format', 'VALIDATION_ERROR');
  }
  return cohortMonth;
}

cohortAnalyticsRouter.post(
  '/track',
  asyncHandler(async (req, res) => {
    const { subscriptionId, customerId, event, amount, currency, occurredAt, planId } = req.body as Record<
      string,
      unknown
    >;

    if (
      typeof subscriptionId !== 'string' ||
      subscriptionId.length === 0 ||
      typeof customerId !== 'string' ||
      customerId.length === 0 ||
      typeof event !== 'string' ||
      !LIFECYCLE_EVENTS.includes(event as SubscriptionLifecycleEventType) ||
      typeof amount !== 'number' ||
      Number.isNaN(amount) ||
      amount < 0 ||
      typeof currency !== 'string' ||
      currency.length === 0 ||
      (planId !== undefined && typeof planId !== 'string')
    ) {
      throw new AppError(400, 'Invalid subscription lifecycle event payload', 'VALIDATION_ERROR');
    }

    const occurredAtDate = typeof occurredAt === 'string' ? new Date(occurredAt) : new Date();
    if (Number.isNaN(occurredAtDate.getTime())) {
      throw new AppError(400, 'occurredAt must be a valid date string', 'VALIDATION_ERROR');
    }

    cohortAnalyticsService.track({
      subscriptionId,
      customerId,
      event: event as SubscriptionLifecycleEventType,
      amount,
      currency,
      occurredAt: occurredAtDate,
      planId: planId as string | undefined,
    });

    res.status(201).json({ ok: true });
  }),
);

cohortAnalyticsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: cohortAnalyticsService.getCohorts() });
  }),
);

cohortAnalyticsRouter.get(
  '/:cohortMonth/retention',
  asyncHandler(async (req, res) => {
    const cohortMonth = requireCohortMonth(req);
    res.json({ data: { cohortMonth, retention: cohortAnalyticsService.getRetentionCurve(cohortMonth) } });
  }),
);

cohortAnalyticsRouter.get(
  '/:cohortMonth/revenue',
  asyncHandler(async (req, res) => {
    const cohortMonth = requireCohortMonth(req);
    res.json({ data: { cohortMonth, revenue: cohortAnalyticsService.getRevenueCohort(cohortMonth) } });
  }),
);

cohortAnalyticsRouter.get(
  '/:cohortMonth/churn',
  asyncHandler(async (req, res) => {
    const cohortMonth = requireCohortMonth(req);
    res.json({ data: { cohortMonth, churn: cohortAnalyticsService.getChurnCohort(cohortMonth) } });
  }),
);

cohortAnalyticsRouter.post(
  '/compare',
  asyncHandler(async (req, res) => {
    const { cohortMonths } = req.body as Record<string, unknown>;
    if (
      !Array.isArray(cohortMonths) ||
      cohortMonths.length === 0 ||
      !cohortMonths.every((m) => typeof m === 'string' && COHORT_MONTH_RE.test(m))
    ) {
      throw new AppError(400, 'cohortMonths must be a non-empty array of YYYY-MM strings', 'VALIDATION_ERROR');
    }
    res.json({ data: cohortAnalyticsService.compareCohorts(cohortMonths as string[]) });
  }),
);

cohortAnalyticsRouter.get(
  '/:cohortMonth/export',
  asyncHandler(async (req, res) => {
    const cohortMonth = requireCohortMonth(req);
    const kindRaw = req.query.kind;
    const kind = kindRaw === 'revenue' || kindRaw === 'churn' ? kindRaw : 'retention';

    const csv = cohortAnalyticsService.exportToCsv(cohortMonth, kind);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cohort-${kind}-${cohortMonth}.csv"`);
    res.send(csv);
  }),
);
