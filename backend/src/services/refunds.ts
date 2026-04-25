import { AppError } from '../middleware/errorHandler.js';

export type RefundPolicy = {
  merchantId: string;
  fullRefundWindowDays: number;
  autoApprovalThreshold: number;
  alwaysRefundUnderAmount: number;
  maxPartialRefundPercentage: number;
  requireReason: boolean;
  updatedAt: string;
};

export type RefundDecision = 'approved' | 'manual_review' | 'rejected';

export type RefundEvaluationInput = {
  merchantId: string;
  paymentId: string;
  paymentType: 'card' | 'crypto' | 'bank_transfer';
  amountPaid: number;
  requestedAmount: number;
  daysSincePayment: number;
  reason?: string;
  hasChargeback: boolean;
  hasDispute: boolean;
};

type ManualReviewItem = {
  id: string;
  merchantId: string;
  paymentId: string;
  requestedAmount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reviewedAt?: string;
};

const policyStore = new Map<string, RefundPolicy>();
const refundEvents: Array<{ merchantId: string; decision: RefundDecision; amount: number; createdAt: string }> = [];
const manualReviewQueue = new Map<string, ManualReviewItem>();

const defaultPolicy = (merchantId: string): RefundPolicy => ({
  merchantId,
  fullRefundWindowDays: 30,
  autoApprovalThreshold: 100,
  alwaysRefundUnderAmount: 25,
  maxPartialRefundPercentage: 100,
  requireReason: true,
  updatedAt: new Date().toISOString(),
});

export function upsertRefundPolicy(input: Omit<RefundPolicy, 'updatedAt'>): RefundPolicy {
  const policy: RefundPolicy = {
    ...input,
    updatedAt: new Date().toISOString(),
  };
  policyStore.set(input.merchantId, policy);
  return policy;
}

export function getRefundPolicy(merchantId: string): RefundPolicy {
  return policyStore.get(merchantId) ?? defaultPolicy(merchantId);
}

export function evaluateRefund(input: RefundEvaluationInput) {
  const policy = getRefundPolicy(input.merchantId);
  const reasons: string[] = [];
  let decision: RefundDecision = 'manual_review';

  if (policy.requireReason && !input.reason?.trim()) {
    throw new AppError(400, 'Refund reason is required by policy', 'VALIDATION_ERROR');
  }

  if (input.hasChargeback || input.hasDispute) {
    decision = 'manual_review';
    reasons.push('Chargeback/dispute requires manual review');
  } else if (input.requestedAmount <= policy.alwaysRefundUnderAmount) {
    decision = 'approved';
    reasons.push('Requested amount below always-refund threshold');
  } else if (input.daysSincePayment <= policy.fullRefundWindowDays && input.requestedAmount <= input.amountPaid) {
    decision = 'approved';
    reasons.push('Within full refund window');
  } else {
    const maxPartialAmount = (input.amountPaid * policy.maxPartialRefundPercentage) / 100;
    if (input.requestedAmount > maxPartialAmount) {
      decision = 'rejected';
      reasons.push('Requested amount exceeds partial refund policy');
    } else if (input.requestedAmount <= policy.autoApprovalThreshold) {
      decision = 'approved';
      reasons.push('Within auto-approval threshold');
    } else {
      decision = 'manual_review';
      reasons.push('Exceeds auto-approval threshold');
    }
  }

  if (decision === 'manual_review') {
    enqueueManualReview({
      merchantId: input.merchantId,
      paymentId: input.paymentId,
      requestedAmount: input.requestedAmount,
      reason: input.reason ?? 'No reason provided',
    });
  }

  refundEvents.push({
    merchantId: input.merchantId,
    decision,
    amount: input.requestedAmount,
    createdAt: new Date().toISOString(),
  });

  return {
    decision,
    reasons,
    policy,
    amountApproved: decision === 'approved' ? input.requestedAmount : 0,
  };
}

function enqueueManualReview(input: {
  merchantId: string;
  paymentId: string;
  requestedAmount: number;
  reason: string;
}) {
  const id = `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record: ManualReviewItem = {
    id,
    merchantId: input.merchantId,
    paymentId: input.paymentId,
    requestedAmount: input.requestedAmount,
    reason: input.reason,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  manualReviewQueue.set(id, record);
}

export function listManualReviews(merchantId?: string): ManualReviewItem[] {
  const all = Array.from(manualReviewQueue.values());
  if (!merchantId) return all;
  return all.filter((item) => item.merchantId === merchantId);
}

export function resolveManualReview(reviewId: string, status: 'approved' | 'rejected') {
  const existing = manualReviewQueue.get(reviewId);
  if (!existing) {
    throw new AppError(404, 'Manual review item not found', 'NOT_FOUND');
  }
  const updated: ManualReviewItem = {
    ...existing,
    status,
    reviewedAt: new Date().toISOString(),
  };
  manualReviewQueue.set(reviewId, updated);
  return updated;
}

export function getRefundAnalytics(merchantId: string) {
  const events = refundEvents.filter((event) => event.merchantId === merchantId);
  const counts = events.reduce(
    (acc, event) => {
      acc[event.decision] += 1;
      return acc;
    },
    { approved: 0, manual_review: 0, rejected: 0 }
  );
  return {
    merchantId,
    totalRequests: events.length,
    approvals: counts.approved,
    manualReviews: counts.manual_review,
    rejections: counts.rejected,
    totalRequestedAmount: events.reduce((sum, event) => sum + event.amount, 0),
  };
}
