import { Router, Request, Response } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { requirePermission, resolveWorkspace } from '../middleware/rbac.js';
import {
    evaluateRefund,
    approveRefund,
    rejectRefund,
    processRefundWithStripe,
    getRefund,
    listRefunds,
    getRefundAnalytics,
    upsertRefundPolicy,
    getRefundPolicy,
    listRefundPolicies,
} from '../services/refunds-enhanced.js';

export const refundsEnhancedRouter = Router();

// ── Policy Management ────────────────────────────────────────────────────────

refundsEnhancedRouter.post(
    '/policies',
    resolveWorkspace,
    requirePermission('payment:refund'),
    asyncHandler(async (req: Request, res: Response) => {
        const policy = upsertRefundPolicy(req.body);
        res.status(201).json({ data: policy });
    }),
);

refundsEnhancedRouter.get(
    '/policies',
    resolveWorkspace,
    requirePermission('payment:read'),
    asyncHandler(async (req: Request, res: Response) => {
        const workspaceId = (req as any).workspaceId || req.query.workspaceId as string;
        if (!workspaceId) {
            throw new AppError(400, 'workspaceId is required', 'VALIDATION_ERROR');
        }
        const policies = listRefundPolicies(workspaceId);
        res.json({ data: policies, count: policies.length });
    }),
);

refundsEnhancedRouter.get(
    '/policies/:name',
    resolveWorkspace,
    requirePermission('payment:read'),
    asyncHandler(async (req: Request, res: Response) => {
        const workspaceId = (req as any).workspaceId || req.query.workspaceId as string;
        const name = req.params.name;
        if (!workspaceId) {
            throw new AppError(400, 'workspaceId is required', 'VALIDATION_ERROR');
        }
        const policy = getRefundPolicy(workspaceId, name);
        res.json({ data: policy });
    }),
);

// ── Refund Evaluation ────────────────────────────────────────────────────────

refundsEnhancedRouter.post(
    '/evaluate',
    resolveWorkspace,
    requirePermission('payment:refund'),
    asyncHandler(async (req: Request, res: Response) => {
        const result = evaluateRefund(req.body);
        res.json({ data: result });
    }),
);

// ── Approval Workflow ────────────────────────────────────────────────────────

refundsEnhancedRouter.post(
    '/:refundId/approve',
    resolveWorkspace,
    requirePermission('payment:approve_refund'),
    asyncHandler(async (req: Request, res: Response) => {
        const refundId = req.params.refundId;
        const { level, comment } = req.body;
        const approverId = (req as any).user?.id || req.body.approverId;
        if (!level) {
            throw new AppError(400, 'Approval level is required (first, second, or third)', 'VALIDATION_ERROR');
        }
        const refund = approveRefund(refundId, approverId, level, comment);
        res.json({ data: refund });
    }),
);

refundsEnhancedRouter.post(
    '/:refundId/reject',
    resolveWorkspace,
    requirePermission('payment:approve_refund'),
    asyncHandler(async (req: Request, res: Response) => {
        const refundId = req.params.refundId;
        const { level, comment } = req.body;
        const approverId = (req as any).user?.id || req.body.approverId;
        if (!level) {
            throw new AppError(400, 'Approval level is required (first, second, or third)', 'VALIDATION_ERROR');
        }
        const refund = rejectRefund(refundId, approverId, level, comment);
        res.json({ data: refund });
    }),
);

// ── Stripe Processing ────────────────────────────────────────────────────────

refundsEnhancedRouter.post(
    '/:refundId/process',
    resolveWorkspace,
    requirePermission('payment:refund'),
    asyncHandler(async (req: Request, res: Response) => {
        const refundId = req.params.refundId;
        const { paymentIntentId, amount } = req.body;
        if (!paymentIntentId) {
            throw new AppError(400, 'paymentIntentId is required', 'VALIDATION_ERROR');
        }
        const refund = await processRefundWithStripe(refundId, paymentIntentId, amount);
        res.json({ data: refund });
    }),
);

// ── Query ────────────────────────────────────────────────────────────────────

refundsEnhancedRouter.get(
    '/:refundId',
    resolveWorkspace,
    requirePermission('payment:read'),
    asyncHandler(async (req: Request, res: Response) => {
        const refundId = req.params.refundId;
        const refund = getRefund(refundId);
        if (!refund) {
            throw new AppError(404, 'Refund not found', 'NOT_FOUND');
        }
        res.json({ data: refund });
    }),
);

refundsEnhancedRouter.get(
    '/',
    resolveWorkspace,
    requirePermission('payment:read'),
    asyncHandler(async (req: Request, res: Response) => {
        const workspaceId = (req as any).workspaceId || req.query.workspaceId as string;
        if (!workspaceId) {
            throw new AppError(400, 'workspaceId is required', 'VALIDATION_ERROR');
        }
        const { status, paymentId, limit, offset } = req.query;
        const result = listRefunds(workspaceId, {
            status: status as string,
            paymentId: paymentId as string,
            limit: limit ? parseInt(limit as string, 10) : undefined,
            offset: offset ? parseInt(offset as string, 10) : undefined,
        });
        res.json(result);
    }),
);

// ── Analytics ────────────────────────────────────────────────────────────────

refundsEnhancedRouter.get(
    '/analytics/:workspaceId',
    asyncHandler(async (req: Request, res: Response) => {
        const workspaceId = req.params.workspaceId;
        const analytics = getRefundAnalytics(workspaceId);
        res.json({ data: analytics });
    }),
);