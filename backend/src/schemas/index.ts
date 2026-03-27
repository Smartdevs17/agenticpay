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
