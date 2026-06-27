import { z } from 'zod';

const milestoneSchema = z.object({
  name: z.string().min(1),
  amountPercent: z.number().int().min(1).max(100),
  deadline: z.string().datetime(),
  approverAddress: z.string().min(1),
});

export const createVaultSchema = z.object({
  depositorAddress: z.string().min(1),
  recipientAddress: z.string().min(1),
  totalAmount: z.number().positive(),
  currency: z.string().min(1),
  network: z.string().min(1),
  milestones: z
    .array(milestoneSchema)
    .min(1)
    .refine((ms) => ms.reduce((s, m) => s + m.amountPercent, 0) === 100, {
      message: 'Milestone percentages must sum to 100',
    }),
});

export const approveMilestoneSchema = z.object({
  approverAddress: z.string().min(1),
});

export const releaseMilestoneSchema = z.object({
  txHash: z.string().optional(),
  triggeredBy: z.string().min(1),
});

export const recordDeploymentSchema = z.object({
  contractAddress: z.string().min(1),
  contractVaultId: z.string().min(1),
});

export const resolveDisputeSchema = z.object({
  resolution: z.enum(['release', 'refund']),
});
