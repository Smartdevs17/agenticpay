import { z } from 'zod';

const brandSchema = z.object({
  brandName: z.string().min(1).max(80),
  accentColor: z.string().regex(/^#([A-Fa-f0-9]{6})$/).optional(),
  logoUrl: z.string().url().optional(),
  redirectUrl: z.string().url().optional(),
});

export const createCheckoutSessionSchema = z.object({
  merchantId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  description: z.string().max(280).optional(),
  allowedMethods: z.array(z.enum(['crypto', 'card', 'wallet'])).min(1).default(['crypto', 'card', 'wallet']),
  customerEmail: z.string().email().optional(),
  brand: brandSchema.optional(),
  expiresInMinutes: z.number().int().positive().max(1440).default(30),
});

export const updatePaymentMethodSchema = z.object({
  method: z.enum(['crypto', 'card', 'wallet']),
});

export const processPaymentSchema = z.object({
  cardToken: z.string().optional(),
  walletAddress: z.string().optional(),
});
