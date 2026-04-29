import { z } from 'zod';

// Invoice Generation Schema
export const invoiceSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  merchantId: z.string().min(1, 'Merchant ID is required'),
  workDescription: z.string().min(1, 'Work description is required'),
  hoursWorked: z.number().nonnegative('Hours worked must be a non-negative number').optional(),
  hourlyRate: z.number().nonnegative('Hourly rate must be a non-negative number').optional(),
  countryCode: z.string().length(2, 'Country code must be 2 letters').transform((val) => val.toUpperCase()).optional(),
});

export const invoiceTaxReportSchema = z.object({
  merchantId: z.string().min(1, 'Merchant ID is required'),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const createEscrowSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  payerId: z.string().min(1, 'Payer ID is required'),
  payeeId: z.string().min(1, 'Payee ID is required'),
  currency: z.string().min(1, 'Currency is required'),
  totalAmount: z.number().positive('Total amount must be positive'),
  milestones: z
    .array(
      z.object({
        title: z.string().min(1, 'Milestone title is required'),
        description: z.string().optional(),
        amount: z.number().positive('Milestone amount must be positive'),
        completionCriteria: z.string().min(1, 'Completion criteria is required'),
      })
    )
    .min(1, 'At least one milestone is required'),
  metadata: z.record(z.string()).optional(),
});

export const fundEscrowSchema = z.object({
  amount: z.number().positive('Funding amount must be positive'),
});

export const escrowSubmissionSchema = z.object({
  submissionUrl: z.string().url('A valid submission URL is required'),
  notes: z.string().optional(),
});

export const escrowMilestoneActionSchema = z
  .object({
    approvedBy: z.string().min(1, 'Approver ID is required').optional(),
    reason: z.string().min(1, 'Reason is required').optional(),
  })
  .refine((data) => data.approvedBy || data.reason, 'approvedBy or reason is required');

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

// Merchant Onboarding Schemas
export const onboardingTaskSchema = z.object({
  id: z.string().min(1, 'Task ID is required'),
  title: z.string().min(1, 'Task title is required'),
  description: z.string().min(1, 'Task description is required'),
  type: z.enum(['document_upload', 'form_submission', 'verification', 'compliance_check']),
  required: z.boolean().default(true),
  order: z.number().min(0),
});

export const createOnboardingSchema = z.object({
  merchantId: z.string().min(1, 'Merchant ID is required'),
  businessName: z.string().min(1, 'Business name is required'),
  businessType: z.string().min(1, 'Business type is required'),
  contactEmail: z.string().email('Invalid email address'),
  contactPhone: z.string().optional(),
  website: z.string().url('Invalid website URL').optional(),
});

export const updateOnboardingTaskSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  status: z.enum(['pending', 'in_progress', 'completed', 'skipped', 'failed']),
  data: z.record(z.any()).optional(),
  notes: z.string().optional(),
});

export const submitDocumentSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  documentType: z.enum(['business_license', 'tax_id', 'bank_statement', 'identity_proof', 'address_proof']),
  fileName: z.string().min(1, 'File name is required'),
  fileSize: z.number().positive('File size must be positive'),
  mimeType: z.string().min(1, 'MIME type is required'),
  // In a real implementation, this would be handled by file upload middleware
  fileData: z.string().optional(), // Base64 encoded file data
});

export const skipTaskSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  reason: z.string().min(1, 'Skip reason is required'),
});

export const adminReviewSchema = z.object({
  onboardingId: z.string().min(1, 'Onboarding ID is required'),
  status: z.enum(['approved', 'rejected', 'needs_revision']),
  reviewNotes: z.string().optional(),
  reviewerId: z.string().min(1, 'Reviewer ID is required'),
});

// Split / Refund Schemas
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
