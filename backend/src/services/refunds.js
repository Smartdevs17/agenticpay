"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertRefundPolicy = upsertRefundPolicy;
exports.getRefundPolicy = getRefundPolicy;
exports.evaluateRefund = evaluateRefund;
exports.listManualReviews = listManualReviews;
exports.resolveManualReview = resolveManualReview;
exports.getRefundAnalytics = getRefundAnalytics;
var errorHandler_js_1 = require("../middleware/errorHandler.js");
var policyStore = new Map();
var refundEvents = [];
var manualReviewQueue = new Map();
var defaultPolicy = function (merchantId) { return ({
    merchantId: merchantId,
    fullRefundWindowDays: 30,
    autoApprovalThreshold: 100,
    alwaysRefundUnderAmount: 25,
    maxPartialRefundPercentage: 100,
    requireReason: true,
    updatedAt: new Date().toISOString(),
}); };
function upsertRefundPolicy(input) {
    var policy = __assign(__assign({}, input), { updatedAt: new Date().toISOString() });
    policyStore.set(input.merchantId, policy);
    return policy;
}
function getRefundPolicy(merchantId) {
    var _a;
    return (_a = policyStore.get(merchantId)) !== null && _a !== void 0 ? _a : defaultPolicy(merchantId);
}
function evaluateRefund(input) {
    var _a, _b;
    var policy = getRefundPolicy(input.merchantId);
    var reasons = [];
    var decision = 'manual_review';
    if (policy.requireReason && !((_a = input.reason) === null || _a === void 0 ? void 0 : _a.trim())) {
        throw new errorHandler_js_1.AppError(400, 'Refund reason is required by policy', 'VALIDATION_ERROR');
    }
    if (input.hasChargeback || input.hasDispute) {
        decision = 'manual_review';
        reasons.push('Chargeback/dispute requires manual review');
    }
    else if (input.requestedAmount <= policy.alwaysRefundUnderAmount) {
        decision = 'approved';
        reasons.push('Requested amount below always-refund threshold');
    }
    else if (input.daysSincePayment <= policy.fullRefundWindowDays && input.requestedAmount <= input.amountPaid) {
        decision = 'approved';
        reasons.push('Within full refund window');
    }
    else {
        var maxPartialAmount = (input.amountPaid * policy.maxPartialRefundPercentage) / 100;
        if (input.requestedAmount > maxPartialAmount) {
            decision = 'rejected';
            reasons.push('Requested amount exceeds partial refund policy');
        }
        else if (input.requestedAmount <= policy.autoApprovalThreshold) {
            decision = 'approved';
            reasons.push('Within auto-approval threshold');
        }
        else {
            decision = 'manual_review';
            reasons.push('Exceeds auto-approval threshold');
        }
    }
    if (decision === 'manual_review') {
        enqueueManualReview({
            merchantId: input.merchantId,
            paymentId: input.paymentId,
            requestedAmount: input.requestedAmount,
            reason: (_b = input.reason) !== null && _b !== void 0 ? _b : 'No reason provided',
        });
    }
    refundEvents.push({
        merchantId: input.merchantId,
        decision: decision,
        amount: input.requestedAmount,
        createdAt: new Date().toISOString(),
    });
    return {
        decision: decision,
        reasons: reasons,
        policy: policy,
        amountApproved: decision === 'approved' ? input.requestedAmount : 0,
    };
}
function enqueueManualReview(input) {
    var id = "review_".concat(Date.now(), "_").concat(Math.random().toString(36).slice(2, 8));
    var record = {
        id: id,
        merchantId: input.merchantId,
        paymentId: input.paymentId,
        requestedAmount: input.requestedAmount,
        reason: input.reason,
        status: 'pending',
        createdAt: new Date().toISOString(),
    };
    manualReviewQueue.set(id, record);
}
function listManualReviews(merchantId) {
    var all = Array.from(manualReviewQueue.values());
    if (!merchantId)
        return all;
    return all.filter(function (item) { return item.merchantId === merchantId; });
}
function resolveManualReview(reviewId, status) {
    var existing = manualReviewQueue.get(reviewId);
    if (!existing) {
        throw new errorHandler_js_1.AppError(404, 'Manual review item not found', 'NOT_FOUND');
    }
    var updated = __assign(__assign({}, existing), { status: status, reviewedAt: new Date().toISOString() });
    manualReviewQueue.set(reviewId, updated);
    return updated;
}
function getRefundAnalytics(merchantId) {
    var events = refundEvents.filter(function (event) { return event.merchantId === merchantId; });
    var counts = events.reduce(function (acc, event) {
        acc[event.decision] += 1;
        return acc;
    }, { approved: 0, manual_review: 0, rejected: 0 });
    return {
        merchantId: merchantId,
        totalRequests: events.length,
        approvals: counts.approved,
        manualReviews: counts.manual_review,
        rejections: counts.rejected,
        totalRequestedAmount: events.reduce(function (sum, event) { return sum + event.amount; }, 0),
    };
}
