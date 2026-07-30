import { z } from 'zod';

const brandSchema = z.object({
  brandName: z.string().min(1).max(80),
  accentColor: z.string().regex(/^#([A-Fa-f0-9]{6})$/).optional(),
  logoUrl: z.string().url().optional(),
  redirectUrl: z.string().url().optional(),
});

export const abTestVariantSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  amount: z.number().positive(),
  description: z.string().max(280).optional(),
  accentColor: z.string().regex(/^#([A-Fa-f0-9]{6})$/).optional(),
  ctaText: z.string().max(64).optional(),
  weight: z.number().min(0).max(100).default(50),
});

export const addVariantsSchema = z.object({
  variants: z.array(abTestVariantSchema).min(1).max(10),
});

export const createPaymentLinkSchema = z.object({
  merchantId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  description: z.string().max(280).optional(),
  expiresAt: z.string().datetime(),
  recurrence: z.enum(['one_time', 'weekly', 'monthly']).default('one_time'),
  tags: z.array(z.string().min(1).max(32)).max(20).default([]),
  category: z.string().min(1).max(64).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  brand: brandSchema.optional(),
  variants: z.array(abTestVariantSchema).max(10).optional(),
  password: z.string().min(4).max(128).optional(),
  maxUses: z.number().int().positive().max(1_000_000).optional(),
});

export const bulkCreatePaymentLinkSchema = z.object({
  merchantId: z.string().min(1),
  links: z.array(createPaymentLinkSchema.omit({ merchantId: true })).min(1).max(500),
});

export const updatePaymentLinkSchema = z.object({
  description: z.string().max(280).optional(),
  expiresAt: z.string().datetime().optional(),
  tags: z.array(z.string().min(1).max(32)).max(20).optional(),
  category: z.string().min(1).max(64).optional(),
  brand: brandSchema.optional(),
  variants: z.array(abTestVariantSchema).max(10).optional(),
  isActive: z.boolean().optional(),
});

export const paymentLinkCompletionSchema = z.object({
  amountPaid: z.number().positive().optional(),
  source: z.string().max(64).optional(),
  variantId: z.string().max(64).optional(),
  password: z.string().max(128).optional(),
});