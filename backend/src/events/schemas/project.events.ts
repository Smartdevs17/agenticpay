import { z } from 'zod';

// Project domain events
export const ProjectCreatedSchema = z.object({
  projectId: z.string().uuid(),
  clientId: z.string(),
  contractorId: z.string(),
  title: z.string(),
  description: z.string(),
  totalAmount: z.number().positive(),
  currency: z.string(),
  milestones: z.array(z.object({
    id: z.string().uuid(),
    title: z.string(),
    amount: z.number().positive(),
    dueDate: z.string().datetime(),
  })),
  createdAt: z.string().datetime(),
});

export const ProjectFundedSchema = z.object({
  projectId: z.string().uuid(),
  fundedBy: z.string(),
  amount: z.number().positive(),
  currency: z.string(),
  transactionHash: z.string(),
  fundedAt: z.string().datetime(),
});

export const WorkSubmittedSchema = z.object({
  projectId: z.string().uuid(),
  milestoneId: z.string().uuid(),
  submittedBy: z.string(),
  submissionUrl: z.string().url(),
  description: z.string(),
  submittedAt: z.string().datetime(),
});

export const WorkApprovedSchema = z.object({
  projectId: z.string().uuid(),
  milestoneId: z.string().uuid(),
  approvedBy: z.string(),
  approvedAt: z.string().datetime(),
  comments: z.string().optional(),
});

export const ProjectDisputedSchema = z.object({
  projectId: z.string().uuid(),
  disputedBy: z.string(),
  reason: z.string(),
  disputedAt: z.string().datetime(),
  evidence: z.array(z.string().url()).optional(),
});

export const ProjectCancelledSchema = z.object({
  projectId: z.string().uuid(),
  cancelledBy: z.string(),
  cancelledAt: z.string().datetime(),
  reason: z.string(),
  refundAmount: z.number().nonnegative().optional(),
});

export const ProjectCompletedSchema = z.object({
  projectId: z.string().uuid(),
  completedAt: z.string().datetime(),
  finalAmount: z.number().positive(),
  currency: z.string(),
});

// Event type to schema mapping
export const ProjectEventSchemas = {
  'project.created': ProjectCreatedSchema,
  'project.funded': ProjectFundedSchema,
  'project.work_submitted': WorkSubmittedSchema,
  'project.work_approved': WorkApprovedSchema,
  'project.disputed': ProjectDisputedSchema,
  'project.cancelled': ProjectCancelledSchema,
  'project.completed': ProjectCompletedSchema,
} as const;
