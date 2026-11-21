import { Router, Request, Response } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { requirePermission, resolveWorkspace } from '../middleware/rbac.js';
import {
  evaluateRefund,
  approveRefund,
  rejectRefund,
  processRefund,
  autoProcessApprovedRefunds,
  cancelRefund,
  getRefund,
  listRefunds,
  getRefundHistory,
  getRefundAnalytics,
  getRefundMetricsSummary,
  upsertRefundPolicy,
  getRefundPolicy,
  listRefundPolicies,
  deleteRefundPolicy,
  listRefundJobs,
  getRefundJob,
} from '../services/refund-engine.js';
import { refundQueue } from '../queue/refund-queue.js';
import { refundNotificationService } from '../services/refund-notifications.js';
import {
  refundEnginePolicySchema,
  refundEngineEvaluationSchema,
  refundApprovalSchema,
  refundCancelSchema,
  refundWebhookSubscribeSchema,
} from '../schemas/index.js';

export const refundsAutomatedRouter = Router();

const q = (val: unknown): string | undefined =>
  typeof val === 'string' ? val : Array.isArray(val) ? val[0] : undefined;

const p = (val: unknown): string =>
  typeof val === 'string' ? val : Array.isArray(val) ? val[0] ?? '' : '';

// ── Policy Management ────────────────────────────────────────────────────────

refundsAutomatedRouter.post(
  '/policies',
  resolveWorkspace,
  requirePermission('payment:refund'),
  validate(refundEnginePolicySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const policy = upsertRefundPolicy(req.body);
    res.status(201).json({ data: policy });
  }),
);

refundsAutomatedRouter.get(
  '/policies',
  resolveWorkspace,
  requirePermission('payment:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId || q(req.query.workspaceId);
    if (!workspaceId) {
      throw new AppError(400, 'workspaceId is required', 'ERR_WORKSPACE_REQUIRED');
    }
    const policies = listRefundPolicies(workspaceId);
    res.json({ data: policies, count: policies.length });
  }),
);

refundsAutomatedRouter.get(
  '/policies/:name',
  resolveWorkspace,
  requirePermission('payment:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId || q(req.query.workspaceId);
    const name = p(req.params.name);
    if (!workspaceId) {
      throw new AppError(400, 'workspaceId is required', 'ERR_WORKSPACE_REQUIRED');
    }
    const policy = getRefundPolicy(workspaceId, name);
    res.json({ data: policy });
  }),
);

refundsAutomatedRouter.delete(
  '/policies/:policyId',
  resolveWorkspace,
  requirePermission('payment:refund'),
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = deleteRefundPolicy(p(req.params.policyId));
    if (!deleted) {
      throw new AppError(404, 'Policy not found', 'ERR_POLICY_NOT_FOUND');
    }
    res.json({ data: { deleted: true } });
  }),
);

// ── Refund Evaluation ────────────────────────────────────────────────────────

refundsAutomatedRouter.post(
  '/evaluate',
  resolveWorkspace,
  requirePermission('payment:refund'),
  validate(refundEngineEvaluationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = evaluateRefund(req.body);
    res.json({ data: result });
  }),
);

// ── Approval Workflow ────────────────────────────────────────────────────────

refundsAutomatedRouter.post(
  '/:refundId/approve',
  resolveWorkspace,
  requirePermission('payment:approve_refund'),
  validate(refundApprovalSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const refundId = p(req.params.refundId);
    const { level, comment } = req.body;
    const approverId = (req as any).user?.id || req.body.approverId;
    const refund = approveRefund(refundId, approverId, level, comment);
    await refundNotificationService.notifyRefundApproved(refund);
    res.json({ data: refund });
  }),
);

refundsAutomatedRouter.post(
  '/:refundId/reject',
  resolveWorkspace,
  requirePermission('payment:approve_refund'),
  validate(refundApprovalSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const refundId = p(req.params.refundId);
    const { level, comment } = req.body;
    const approverId = (req as any).user?.id || req.body.approverId;
    const refund = rejectRefund(refundId, approverId, level, comment);
    await refundNotificationService.notifyRefundRejected(refund);
    res.json({ data: refund });
  }),
);

// ── Processing ───────────────────────────────────────────────────────────────

refundsAutomatedRouter.post(
  '/:refundId/process',
  resolveWorkspace,
  requirePermission('payment:refund'),
  asyncHandler(async (req: Request, res: Response) => {
    const refundId = p(req.params.refundId);
    const refund = getRefund(refundId);
    if (!refund) {
      throw new AppError(404, 'Refund not found', 'ERR_REFUND_NOT_FOUND');
    }
    const job = refundQueue.enqueueProcessSingle(refundId);
    res.json({ data: { job, refund } });
  }),
);

refundsAutomatedRouter.post(
  '/:refundId/process-sync',
  resolveWorkspace,
  requirePermission('payment:refund'),
  asyncHandler(async (req: Request, res: Response) => {
    const refundId = p(req.params.refundId);
    const refund = await processRefund(refundId);
    await refundNotificationService.notifyRefundCompleted(refund);
    res.json({ data: refund });
  }),
);

refundsAutomatedRouter.post(
  '/:refundId/cancel',
  resolveWorkspace,
  requirePermission('payment:refund'),
  validate(refundCancelSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const refundId = p(req.params.refundId);
    const actor = (req as any).user?.id || 'system';
    const refund = cancelRefund(refundId, actor, req.body.reason);
    await refundNotificationService.notifyRefundCancelled(refund);
    res.json({ data: refund });
  }),
);

refundsAutomatedRouter.post(
  '/:refundId/retry',
  resolveWorkspace,
  requirePermission('payment:refund'),
  asyncHandler(async (req: Request, res: Response) => {
    const refundId = p(req.params.refundId);
    const job = refundQueue.enqueueRetryFailed(refundId);
    res.json({ data: { job, message: 'Retry job queued' } });
  }),
);

// ── Auto-Process ─────────────────────────────────────────────────────────────

refundsAutomatedRouter.post(
  '/auto-process',
  resolveWorkspace,
  requirePermission('payment:refund'),
  asyncHandler(async (req: Request, res: Response) => {
    const job = refundQueue.enqueueAutoProcess();
    res.json({ data: { job, message: 'Auto-process job queued' } });
  }),
);

refundsAutomatedRouter.post(
  '/auto-process-sync',
  resolveWorkspace,
  requirePermission('payment:refund'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await autoProcessApprovedRefunds();
    res.json({ data: result });
  }),
);

// ── Query ────────────────────────────────────────────────────────────────────

refundsAutomatedRouter.get(
  '/:refundId',
  resolveWorkspace,
  requirePermission('payment:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const refundId = p(req.params.refundId);
    const refund = getRefund(refundId);
    if (!refund) {
      throw new AppError(404, 'Refund not found', 'ERR_REFUND_NOT_FOUND');
    }
    res.json({ data: refund });
  }),
);

refundsAutomatedRouter.get(
  '/',
  resolveWorkspace,
  requirePermission('payment:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId || q(req.query.workspaceId);
    if (!workspaceId) {
      throw new AppError(400, 'workspaceId is required', 'ERR_WORKSPACE_REQUIRED');
    }
    const statusVal = q(req.query.status);
    const statusArr = statusVal ? statusVal.split(',') : undefined;

    const result = listRefunds(workspaceId, {
      status: statusArr as any,
      paymentId: q(req.query.paymentId),
      paymentType: q(req.query.paymentType) as any,
      fromDate: q(req.query.fromDate),
      toDate: q(req.query.toDate),
      limit: q(req.query.limit) ? parseInt(q(req.query.limit)!, 10) : undefined,
      offset: q(req.query.offset) ? parseInt(q(req.query.offset)!, 10) : undefined,
      sortBy: (q(req.query.sortBy) as any) ?? 'createdAt',
      sortOrder: (q(req.query.sortOrder) as any) ?? 'desc',
    });
    res.json(result);
  }),
);

refundsAutomatedRouter.get(
  '/:refundId/history',
  resolveWorkspace,
  requirePermission('payment:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const refundId = p(req.params.refundId);
    const history = getRefundHistory(refundId);
    res.json({ data: history });
  }),
);

// ── Analytics ────────────────────────────────────────────────────────────────

refundsAutomatedRouter.get(
  '/analytics/:workspaceId',
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = p(req.params.workspaceId);
    const fromDate = q(req.query.fromDate);
    const toDate = q(req.query.toDate);
    const granularity = (q(req.query.granularity) as 'day' | 'week' | 'month' | undefined) ?? 'day';
    const analytics = getRefundAnalytics({ workspaceId, fromDate, toDate, granularity });
    res.json({ data: analytics });
  }),
);

refundsAutomatedRouter.get(
  '/analytics/:workspaceId/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const summary = getRefundMetricsSummary();
    res.json({ data: summary });
  }),
);

// ── Queue / Job Management ───────────────────────────────────────────────────

refundsAutomatedRouter.get(
  '/queue/jobs',
  resolveWorkspace,
  requirePermission('payment:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId || q(req.query.workspaceId);
    if (!workspaceId) {
      throw new AppError(400, 'workspaceId is required', 'ERR_WORKSPACE_REQUIRED');
    }
    const status = q(req.query.status);
    const jobs = listRefundJobs(workspaceId, status as any);
    res.json({ data: jobs, count: jobs.length });
  }),
);

refundsAutomatedRouter.get(
  '/queue/jobs/:jobId',
  resolveWorkspace,
  requirePermission('payment:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const job = getRefundJob(p(req.params.jobId));
    if (!job) {
      throw new AppError(404, 'Job not found', 'ERR_JOB_NOT_FOUND');
    }
    res.json({ data: job });
  }),
);

refundsAutomatedRouter.get(
  '/queue/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ data: refundQueue.stats() });
  }),
);

// ── Webhook Subscriptions ────────────────────────────────────────────────────

refundsAutomatedRouter.post(
  '/webhooks/subscribe',
  resolveWorkspace,
  requirePermission('payment:refund'),
  validate(refundWebhookSubscribeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId || req.body.workspaceId;
    const { url, events, secret } = req.body;
    refundNotificationService.subscribeWebhook(workspaceId, url, events, secret);
    res.status(201).json({ data: { url, events } });
  }),
);

refundsAutomatedRouter.delete(
  '/webhooks/subscribe',
  resolveWorkspace,
  requirePermission('payment:refund'),
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId || q(req.query.workspaceId);
    const url = q(req.query.url);
    if (!url) {
      throw new AppError(400, 'url is required', 'ERR_URL_REQUIRED');
    }
    const removed = refundNotificationService.unsubscribeWebhook(workspaceId, url);
    if (!removed) {
      throw new AppError(404, 'Webhook subscription not found', 'ERR_WEBHOOK_NOT_FOUND');
    }
    res.json({ data: { removed: true } });
  }),
);

refundsAutomatedRouter.get(
  '/webhooks/subscriptions',
  resolveWorkspace,
  requirePermission('payment:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId || q(req.query.workspaceId);
    if (!workspaceId) {
      throw new AppError(400, 'workspaceId is required', 'ERR_WORKSPACE_REQUIRED');
    }
    const subs = refundNotificationService.listWebhookSubscriptions(workspaceId);
    res.json({ data: subs });
  }),
);
