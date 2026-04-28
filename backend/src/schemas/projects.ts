import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(2).max(120),
  clientId: z.string().min(1),
  ownerId: z.string().min(1),
  budget: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  description: z.string().max(500).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  budget: z.number().positive().optional(),
  endDate: z.string().datetime().optional(),
  description: z.string().max(500).optional(),
  status: z.enum(['active', 'completed', 'disputed', 'abandoned']).optional(),
});

export const addMilestoneSchema = z.object({
  title: z.string().min(2).max(120),
  deliverable: z.string().min(2).max(400),
  amount: z.number().positive(),
  dueDate: z.string().datetime(),
});

export const submitDeliverableSchema = z.object({
  submissionUrl: z.string().url(),
  notes: z.string().max(500).optional(),
});

export const approveDeliverableSchema = z.object({
  approvedBy: z.string().min(1),
  notes: z.string().max(500).optional(),
});

export const disputeDeliverableSchema = z.object({
  disputedBy: z.string().min(1),
  reason: z.string().min(4).max(500),
});

export const scopeChangeSchema = z.object({
  additionalBudget: z.number().positive(),
  reason: z.string().min(4).max(500),
});