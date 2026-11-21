import { z } from 'zod';

export const createBudgetSchema = z.object({
  walletAddress: z.string().min(1),
  chainId: z.number().int().positive(),
  limitGwei: z.number().positive(),
  resetAt: z.string().datetime(),
});

export const checkBudgetSchema = z.object({
  walletAddress: z.string().min(1),
  chainId: z.number().int().positive(),
  estimatedGwei: z.number().positive(),
});

export const recordUsageSchema = z.object({
  walletAddress: z.string().min(1),
  chainId: z.number().int().positive(),
  usedGwei: z.number().positive(),
});
