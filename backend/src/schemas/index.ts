import { z } from 'zod';

// Invoice Generation Schema
export const invoiceSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  workDescription: z.string().min(1, 'Work description is required'),
  hoursWorked: z.number().nonnegative('Hours worked must be a non-negative number').optional(),
  hourlyRate: z.number().nonnegative('Hourly rate must be a non-negative number').optional(),
});

// Single Work Verification Schema
export const verificationSchema = z.object({
  repositoryUrl: z.string().url('Invalid repository URL'),
  milestoneDescription: z.string().min(1, 'Milestone description is required'),
  projectId: z.string().min(1, 'Project ID is required'),
});

// Bulk Work Verification Schema
export const bulkVerificationSchema = z.object({
  items: z.array(verificationSchema).min(1, 'Missing items for bulk verification'),
});

// Bulk Update Schema
export const bulkUpdateSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1, 'Verification ID is required'),
        status: z.enum(['passed', 'failed', 'pending']).optional(),
        score: z.number().min(0).max(100).optional(),
        summary: z.string().optional(),
        details: z.array(z.string()).optional(),
      }).refine((data) => {
        return (
          data.status !== undefined ||
          data.score !== undefined ||
          data.summary !== undefined ||
          data.details !== undefined
        );
      }, 'No update fields provided for item')
    )
    .min(1, 'Missing items for bulk update'),
});

// Bulk Delete Schema
export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Missing ids for bulk delete'),
});

const splitRecipientSchema = z.object({
  recipientId: z.string().min(1, 'Recipient id is required'),
  walletAddress: z.string().min(1, 'Wallet address is required'),
  percentage: z.number().positive().max(100),
  minimumThreshold: z.number().nonnegative().default(0),
});

export const splitConfigSchema = z.object({
  merchantId: z.string().min(1, 'Merchant id is required'),
  platformFeePercentage: z.number().min(0).max(100).default(0),
  recipients: z.array(splitRecipientSchema).min(1, 'At least one split recipient is required'),
});

export const splitExecutionSchema = z.object({
  paymentId: z.string().min(1, 'Payment id is required'),
  totalAmount: z.number().positive(),
  currency: z.string().min(1).default('USD'),
});

export const splitUpdateSchema = z.object({
  recipients: z.array(splitRecipientSchema).min(1).optional(),
  platformFeePercentage: z.number().min(0).max(100).optional(),
});

export const refundPolicySchema = z.object({
  merchantId: z.string().min(1, 'Merchant id is required'),
  fullRefundWindowDays: z.number().int().min(0).default(30),
  autoApprovalThreshold: z.number().nonnegative().default(100),
  alwaysRefundUnderAmount: z.number().nonnegative().default(0),
  maxPartialRefundPercentage: z.number().min(0).max(100).default(100),
  requireReason: z.boolean().default(true),
});

export const refundEvaluationSchema = z.object({
  merchantId: z.string().min(1, 'Merchant id is required'),
  paymentId: z.string().min(1, 'Payment id is required'),
  paymentType: z.enum(['card', 'crypto', 'bank_transfer']),
  amountPaid: z.number().positive(),
  requestedAmount: z.number().positive(),
  daysSincePayment: z.number().int().min(0),
  reason: z.string().optional(),
  hasChargeback: z.boolean().default(false),
  hasDispute: z.boolean().default(false),
});
