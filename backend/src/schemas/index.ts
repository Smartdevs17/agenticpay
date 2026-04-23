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
