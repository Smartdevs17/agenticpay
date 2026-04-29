import { z } from 'zod';

export const batchPaymentRowSchema = z.object({
  recipient: z.string().min(1, 'recipient is required'),
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/, 'amount must be a positive decimal'),
  asset: z.string().default('XLM'),
  memo: z.string().max(28).optional(),
});

export const batchSubmitSchema = z.object({
  payments: z.array(batchPaymentRowSchema).min(1).max(1000),
  label: z.string().max(100).optional(),
});

export type BatchPaymentRow = z.infer<typeof batchPaymentRowSchema>;
