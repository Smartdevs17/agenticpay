import { z } from 'zod';

export const verifyBankAccountSchema = z.object({
  accountHolderName: z.string().min(2),
  bankName: z.string().min(2),
  accountNumberMasked: z.string().min(4).max(17),
  routingNumber: z.string().regex(/^\d{9}$/),
  verificationMethod: z.enum(['plaid', 'micro_deposit']),
  countryCode: z.string().length(2).default('US'),
});

export const confirmMicroDepositsSchema = z.object({
  amountsInCents: z.array(z.number().int().positive()).length(2),
});

const recipientSchema = z.object({
  name: z.string().min(2),
  accountNumberMasked: z.string().min(4).max(17),
  routingNumber: z.string().regex(/^\d{9}$/),
  bankName: z.string().min(2),
  countryCode: z.string().length(2).default('US'),
  swiftCode: z.string().optional(),
});

export const initiateFiatPaymentSchema = z.object({
  method: z.enum(['ach', 'wire']),
  bankAccountId: z.string().min(1),
  recipient: recipientSchema,
  amount: z.number().positive(),
  currency: z.literal('USD'),
  description: z.string().max(280).optional(),
  isInternational: z.boolean().default(false),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const approvePaymentSchema = z.object({
  approvedBy: z.string().min(2),
});

export const batchPaymentSchema = z.object({
  reference: z.string().min(2).max(120),
  payments: z.array(initiateFiatPaymentSchema).min(1).max(200),
});

export const bankWebhookSchema = z.object({
  paymentId: z.string().min(1),
  eventType: z.enum(['processing', 'settled', 'failed', 'returned']),
  reason: z.string().max(280).optional(),
  bankReference: z.string().max(120).optional(),
});