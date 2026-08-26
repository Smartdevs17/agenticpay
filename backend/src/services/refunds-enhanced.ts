import { randomUUID } from 'node:crypto';
import { AppError } from '../middleware/errorHandler.js';
import { createRefund as stripeCreateRefund, getRefund as stripeGetRefund } from './stripe.js';
import { ImmutableAuditLogger } from '../audit/immutable-logger.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type RefundPolicy = {
    id: string;
    workspaceId: string;
    name: string;
    fullRefundWindowDays: number;
    autoApprovalThreshold: number;
    alwaysRefundUnderAmount: number;
    maxPartialRefundPct: number;
    requireReason: boolean;
    firstApprovalThreshold: number;
    secondApprovalThreshold: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
};

export type RefundDecision = 'approved' | 'manual_review' | 'rejected';

export type RefundEvaluationInput = {
    workspaceId: string;
    paymentId: string;
    paymentType: 'card' | 'crypto' | 'bank_transfer';
    amountPaid: number;
    requestedAmount: number;
    daysSincePayment: number;
    reason?: string;
    hasChargeback: boolean;
    hasDispute: boolean;
    lineItems?: Array<{ label: string; amount: number; quantity: number; reason?: string }>;
};

export type RefundRecord = {
    id: string;
    workspaceId: string;
    paymentId: string;
    stripeRefundId?: string;
    amount: number;
    currency: string;
    reason?: string;
    status: 'pending' | 'approved' | 'rejected' | 'processing' | 'completed' | 'failed';
    decision?: RefundDecision;
    decisionReasons: string[];
    requestedBy?: string;
    approvedBy?: string;
    processedAt?: string;
    completedAt?: string;
    lineItems: Array<{ label: string; amount: number; quantity: number; reason?: string }>;
    approvals: Array<{
        level: 'first' | 'second' | 'third';
        approverId: string;
        status: 'pending' | 'approved' | 'rejected';
        comment?: string;
        approvedAt?: string;
    }>;
    metadata?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

export type RefundAnalytics = {
    workspaceId: string;
    totalRequests: number;
    approvals: number;
    manualReviews: number;
    rejections: number;
    totalRequestedAmount: number;
    totalRefundedAmount: number;
    approvalRate: number;
    byReason: Record<string, number>;
    byStatus: Record<string, number>;
    averageProcessingTimeMs: number;
};

// ── In-Memory Store (replace with Prisma in production) ──────────────────────

const policyStore = new Map<string, RefundPolicy>();
const refundStore = new Map<string, RefundRecord>();
const refundEvents: Array<{
    workspaceId: string;
    decision: RefundDecision;
    amount: number;
    reason?: string;
    createdAt: string;
}> = [];

const auditLogger = new ImmutableAuditLogger();

// ── Default Policy ───────────────────────────────────────────────────────────

const defaultPolicy = (workspaceId: string): RefundPolicy => ({
    id: randomUUID(),
    workspaceId,
    name: 'default',
    fullRefundWindowDays: 30,
    autoApprovalThreshold: 100,
    alwaysRefundUnderAmount: 25,
    maxPartialRefundPct: 100,
    requireReason: true,
    firstApprovalThreshold: 500,
    secondApprovalThreshold: 5000,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
});

// ── Policy Management ────────────────────────────────────────────────────────

export function upsertRefundPolicy(
    input: Omit<RefundPolicy, 'id' | 'createdAt' | 'updatedAt'>,
): RefundPolicy {
    const existing = Array.from(policyStore.values()).find(
        (p) => p.workspaceId === input.workspaceId && p.name === input.name,
    );

    const policy: RefundPolicy = {
        ...(existing ?? {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
        }),
        ...input,
        updatedAt: new Date().toISOString(),
    };

    policyStore.set(policy.id, policy);

    auditLogger.log({
        actor: 'system',
        action: existing ? 'refund_policy.updated' : 'refund_policy.created',
        resource: `refund_policy:${policy.id}`,
        details: { workspaceId: input.workspaceId, name: input.name },
    });

    return policy;
}

export function getRefundPolicy(workspaceId: string, name?: string): RefundPolicy {
    const policies = Array.from(policyStore.values()).filter(
        (p) => p.workspaceId === workspaceId && p.isActive,
    );
    if (name) {
        return policies.find((p) => p.name === name) ?? defaultPolicy(workspaceId);
    }
    return policies[0] ?? defaultPolicy(workspaceId);
}

export function listRefundPolicies(workspaceId: string): RefundPolicy[] {
    return Array.from(policyStore.values()).filter(
        (p) => p.workspaceId === workspaceId,
    );
}

// ── Refund Evaluation Engine ─────────────────────────────────────────────────

export function evaluateRefund(input: RefundEvaluationInput): {
    decision: RefundDecision;
    reasons: string[];
    policy: RefundPolicy;
    amountApproved: number;
    requiredApprovalLevel?: 'first' | 'second' | 'third';
} {
    const policy = getRefundPolicy(input.workspaceId);
    const reasons: string[] = [];
    let decision: RefundDecision = 'manual_review';
    let requiredApprovalLevel: 'first' | 'second' | 'third' | undefined;

    if (policy.requireReason && !input.reason?.trim()) {
        throw new AppError(400, 'Refund reason is required by policy', 'VALIDATION_ERROR');
    }

    // Check for chargeback/dispute — always manual review
    if (input.hasChargeback || input.hasDispute) {
        decision = 'manual_review';
        reasons.push('Chargeback/dispute requires manual review');
        requiredApprovalLevel = 'first';
    }
    // Always refund under threshold
    else if (input.requestedAmount <= policy.alwaysRefundUnderAmount) {
        decision = 'approved';
        reasons.push('Requested amount below always-refund threshold');
    }
    // Within full refund window
    else if (
        input.daysSincePayment <= policy.fullRefundWindowDays &&
        input.requestedAmount <= input.amountPaid
    ) {
        decision = 'approved';
        reasons.push('Within full refund window');
    }
    // Check partial refund limits
    else {
        const maxPartialAmount = (input.amountPaid * policy.maxPartialRefundPct) / 100;
        if (input.requestedAmount > maxPartialAmount) {
            decision = 'rejected';
            reasons.push('Requested amount exceeds partial refund policy');
        }
        // Auto-approval threshold
        else if (input.requestedAmount <= policy.autoApprovalThreshold) {
            decision = 'approved';
            reasons.push('Within auto-approval threshold');
        }
        // Multi-level approval thresholds
        else if (input.requestedAmount <= policy.firstApprovalThreshold) {
            decision = 'manual_review';
            requiredApprovalLevel = 'first';
            reasons.push('Requires first-level approval');
        } else if (input.requestedAmount <= policy.secondApprovalThreshold) {
            decision = 'manual_review';
            requiredApprovalLevel = 'second';
            reasons.push('Requires second-level approval');
        } else {
            decision = 'manual_review';
            requiredApprovalLevel = 'third';
            reasons.push('Requires third-level approval');
        }
    }

    // Create refund record
    const refund: RefundRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        paymentId: input.paymentId,
        amount: input.requestedAmount,
        currency: 'USD',
        reason: input.reason,
        status: decision === 'approved' ? 'approved' : 'pending',
        decision,
        decisionReasons: reasons,
        lineItems: (input.lineItems ?? []).map((li) => ({
            label: li.label,
            amount: li.amount,
            quantity: li.quantity,
            reason: li.reason,
        })),
        approvals: requiredApprovalLevel
            ? [
                {
                    level: requiredApprovalLevel,
                    approverId: '',
                    status: 'pending',
                },
            ]
            : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    refundStore.set(refund.id, refund);

    // Track event for analytics
    refundEvents.push({
        workspaceId: input.workspaceId,
        decision,
        amount: input.requestedAmount,
        reason: input.reason,
        createdAt: new Date().toISOString(),
    });

    auditLogger.log({
        actor: 'system',
        action: `refund.${decision}`,
        resource: `refund:${refund.id}`,
        details: {
            workspaceId: input.workspaceId,
            paymentId: input.paymentId,
            amount: input.requestedAmount,
            decision,
            reasons,
        },
    });

    return {
        decision,
        reasons,
        policy,
        amountApproved: decision === 'approved' ? input.requestedAmount : 0,
        requiredApprovalLevel,
    };
}

// ── Approval Workflow ────────────────────────────────────────────────────────

export function approveRefund(
    refundId: string,
    approverId: string,
    level: 'first' | 'second' | 'third',
    comment?: string,
): RefundRecord {
    const refund = refundStore.get(refundId);
    if (!refund) {
        throw new AppError(404, 'Refund not found', 'NOT_FOUND');
    }

    const approval = refund.approvals.find((a) => a.level === level);
    if (!approval) {
        throw new AppError(400, `No ${level} approval required for this refund`, 'VALIDATION_ERROR');
    }

    if (approval.status !== 'pending') {
        throw new AppError(400, `Approval at level ${level} has already been resolved`, 'VALIDATION_ERROR');
    }

    approval.status = 'approved';
    approval.approverId = approverId;
    approval.comment = comment;
    approval.approvedAt = new Date().toISOString();

    // Check if all required approvals are met
    const allApproved = refund.approvals.every((a) => a.status === 'approved');
    if (allApproved) {
        refund.status = 'approved';
        refund.decision = 'approved';
        refund.approvedBy = approverId;
    }

    refund.updatedAt = new Date().toISOString();
    refundStore.set(refundId, refund);

    auditLogger.log({
        actor: approverId,
        action: 'refund.approved',
        resource: `refund:${refundId}`,
        details: { level, comment },
    });

    return refund;
}

export function rejectRefund(
    refundId: string,
    approverId: string,
    level: 'first' | 'second' | 'third',
    comment?: string,
): RefundRecord {
    const refund = refundStore.get(refundId);
    if (!refund) {
        throw new AppError(404, 'Refund not found', 'NOT_FOUND');
    }

    const approval = refund.approvals.find((a) => a.level === level);
    if (!approval) {
        throw new AppError(400, `No ${level} approval required for this refund`, 'VALIDATION_ERROR');
    }

    approval.status = 'rejected';
    approval.approverId = approverId;
    approval.comment = comment;
    approval.approvedAt = new Date().toISOString();

    refund.status = 'rejected';
    refund.decision = 'rejected';
    refund.updatedAt = new Date().toISOString();
    refundStore.set(refundId, refund);

    auditLogger.log({
        actor: approverId,
        action: 'refund.rejected',
        resource: `refund:${refundId}`,
        details: { level, comment },
    });

    return refund;
}

// ── Stripe Integration ───────────────────────────────────────────────────────

export async function processRefundWithStripe(
    refundId: string,
    paymentIntentId: string,
    amount?: number,
): Promise<RefundRecord> {
    const refund = refundStore.get(refundId);
    if (!refund) {
        throw new AppError(404, 'Refund not found', 'NOT_FOUND');
    }

    if (refund.status !== 'approved') {
        throw new AppError(400, 'Refund must be approved before processing', 'VALIDATION_ERROR');
    }

    refund.status = 'processing';
    refund.processedAt = new Date().toISOString();
    refundStore.set(refundId, refund);

    try {
        const stripeRefund = await stripeCreateRefund({
            paymentIntentId,
            amount: amount ? Math.round(amount * 100) : undefined, // Convert to cents
            reason: 'requested_by_customer',
        });

        refund.stripeRefundId = stripeRefund.id;
        refund.status = 'completed';
        refund.completedAt = new Date().toISOString();
        refund.updatedAt = new Date().toISOString();
        refundStore.set(refundId, refund);

        auditLogger.log({
            actor: 'system',
            action: 'refund.processed.stripe',
            resource: `refund:${refundId}`,
            details: {
                stripeRefundId: stripeRefund.id,
                amount: stripeRefund.amount,
                status: stripeRefund.status,
            },
        });
    } catch (error) {
        refund.status = 'failed';
        refund.updatedAt = new Date().toISOString();
        refundStore.set(refundId, refund);

        auditLogger.log({
            actor: 'system',
            action: 'refund.failed',
            resource: `refund:${refundId}`,
            details: { error: String(error) },
        });

        throw new AppError(500, 'Failed to process refund with Stripe', 'STRIPE_REFUND_FAILED');
    }

    return refund;
}

// ── Query ────────────────────────────────────────────────────────────────────

export function getRefund(refundId: string): RefundRecord | undefined {
    return refundStore.get(refundId);
}

export function listRefunds(workspaceId: string, filters?: {
    status?: string;
    paymentId?: string;
    limit?: number;
    offset?: number;
}): { items: RefundRecord[]; total: number } {
    let items = Array.from(refundStore.values()).filter(
        (r) => r.workspaceId === workspaceId,
    );

    if (filters?.status) {
        items = items.filter((r) => r.status === filters.status);
    }
    if (filters?.paymentId) {
        items = items.filter((r) => r.paymentId === filters.paymentId);
    }

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = items.length;
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;
    items = items.slice(offset, offset + limit);

    return { items, total };
}

// ── Analytics ────────────────────────────────────────────────────────────────

export function getRefundAnalytics(workspaceId: string): RefundAnalytics {
    const events = refundEvents.filter((e) => e.workspaceId === workspaceId);
    const refunds = Array.from(refundStore.values()).filter(
        (r) => r.workspaceId === workspaceId,
    );

    const counts = events.reduce(
        (acc, event) => {
            acc[event.decision] += 1;
            return acc;
        },
        { approved: 0, manual_review: 0, rejected: 0 } as Record<string, number>,
    );

    const byReason: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalProcessingTimeMs = 0;
    let processingCount = 0;

    for (const refund of refunds) {
        byStatus[refund.status] = (byStatus[refund.status] || 0) + 1;
        if (refund.reason) {
            byReason[refund.reason] = (byReason[refund.reason] || 0) + 1;
        }
        if (refund.processedAt && refund.completedAt) {
            totalProcessingTimeMs +=
                new Date(refund.completedAt).getTime() - new Date(refund.processedAt).getTime();
            processingCount++;
        }
    }

    const totalRequestedAmount = events.reduce((sum, e) => sum + e.amount, 0);
    const totalRefundedAmount = refunds
        .filter((r) => r.status === 'completed')
        .reduce((sum, r) => sum + r.amount, 0);

    return {
        workspaceId,
        totalRequests: events.length,
        approvals: counts.approved,
        manualReviews: counts.manual_review,
        rejections: counts.rejected,
        totalRequestedAmount,
        totalRefundedAmount,
        approvalRate: events.length > 0 ? counts.approved / events.length : 0,
        byReason,
        byStatus,
        averageProcessingTimeMs:
            processingCount > 0 ? totalProcessingTimeMs / processingCount : 0,
    };
}

// ── Test Helpers ─────────────────────────────────────────────────────────────

export function resetForTests(): void {
    policyStore.clear();
    refundStore.clear();
    refundEvents.length = 0;
}