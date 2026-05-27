"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refundEvaluationSchema = exports.refundPolicySchema = exports.splitUpdateSchema = exports.splitExecutionSchema = exports.splitConfigSchema = exports.bulkDeleteSchema = exports.bulkUpdateSchema = exports.bulkVerificationSchema = exports.verificationSchema = exports.invoiceSchema = void 0;
var zod_1 = require("zod");
// Invoice Generation Schema
exports.invoiceSchema = zod_1.z.object({
    projectId: zod_1.z.string().min(1, 'Project ID is required'),
    workDescription: zod_1.z.string().min(1, 'Work description is required'),
    hoursWorked: zod_1.z.number().nonnegative('Hours worked must be a non-negative number').optional(),
    hourlyRate: zod_1.z.number().nonnegative('Hourly rate must be a non-negative number').optional(),
});
// Single Work Verification Schema
exports.verificationSchema = zod_1.z.object({
    repositoryUrl: zod_1.z.string().url('Invalid repository URL'),
    milestoneDescription: zod_1.z.string().min(1, 'Milestone description is required'),
    projectId: zod_1.z.string().min(1, 'Project ID is required'),
});
// Bulk Work Verification Schema
exports.bulkVerificationSchema = zod_1.z.object({
    items: zod_1.z.array(exports.verificationSchema).min(1, 'Missing items for bulk verification'),
});
// Bulk Update Schema
exports.bulkUpdateSchema = zod_1.z.object({
    items: zod_1.z
        .array(zod_1.z.object({
        id: zod_1.z.string().min(1, 'Verification ID is required'),
        status: zod_1.z.enum(['passed', 'failed', 'pending']).optional(),
        score: zod_1.z.number().min(0).max(100).optional(),
        summary: zod_1.z.string().optional(),
        details: zod_1.z.array(zod_1.z.string()).optional(),
    }).refine(function (data) {
        return (data.status !== undefined ||
            data.score !== undefined ||
            data.summary !== undefined ||
            data.details !== undefined);
    }, 'No update fields provided for item'))
        .min(1, 'Missing items for bulk update'),
});
// Bulk Delete Schema
exports.bulkDeleteSchema = zod_1.z.object({
    ids: zod_1.z.array(zod_1.z.string().min(1)).min(1, 'Missing ids for bulk delete'),
});
var splitRecipientSchema = zod_1.z.object({
    recipientId: zod_1.z.string().min(1, 'Recipient id is required'),
    walletAddress: zod_1.z.string().min(1, 'Wallet address is required'),
    percentage: zod_1.z.number().positive().max(100),
    minimumThreshold: zod_1.z.number().nonnegative().default(0),
});
exports.splitConfigSchema = zod_1.z.object({
    merchantId: zod_1.z.string().min(1, 'Merchant id is required'),
    platformFeePercentage: zod_1.z.number().min(0).max(100).default(0),
    recipients: zod_1.z.array(splitRecipientSchema).min(1, 'At least one split recipient is required'),
});
exports.splitExecutionSchema = zod_1.z.object({
    paymentId: zod_1.z.string().min(1, 'Payment id is required'),
    totalAmount: zod_1.z.number().positive(),
    currency: zod_1.z.string().min(1).default('USD'),
});
exports.splitUpdateSchema = zod_1.z.object({
    recipients: zod_1.z.array(splitRecipientSchema).min(1).optional(),
    platformFeePercentage: zod_1.z.number().min(0).max(100).optional(),
});
exports.refundPolicySchema = zod_1.z.object({
    merchantId: zod_1.z.string().min(1, 'Merchant id is required'),
    fullRefundWindowDays: zod_1.z.number().int().min(0).default(30),
    autoApprovalThreshold: zod_1.z.number().nonnegative().default(100),
    alwaysRefundUnderAmount: zod_1.z.number().nonnegative().default(0),
    maxPartialRefundPercentage: zod_1.z.number().min(0).max(100).default(100),
    requireReason: zod_1.z.boolean().default(true),
});
exports.refundEvaluationSchema = zod_1.z.object({
    merchantId: zod_1.z.string().min(1, 'Merchant id is required'),
    paymentId: zod_1.z.string().min(1, 'Payment id is required'),
    paymentType: zod_1.z.enum(['card', 'crypto', 'bank_transfer']),
    amountPaid: zod_1.z.number().positive(),
    requestedAmount: zod_1.z.number().positive(),
    daysSincePayment: zod_1.z.number().int().min(0),
    reason: zod_1.z.string().optional(),
    hasChargeback: zod_1.z.boolean().default(false),
    hasDispute: zod_1.z.boolean().default(false),
});
