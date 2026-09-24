import { z } from 'zod';

export const zapierTriggerTypeSchema = z.enum([
  'payment.succeeded',
  'payment.failed',
  'invoice.created',
  'invoice.paid',
  'dispute.opened',
  'dispute.resolved',
  'refund.created',
  'refund.completed',
  'webhook.test',
]);

export type ZapierTriggerType = z.infer<typeof zapierTriggerTypeSchema>;

export const zapierSubscriptionSchema = z.object({
  id: z.string(),
  hookUrl: z.string().url(),
  event: zapierTriggerTypeSchema,
  targetUrl: z.string().url().optional(),
  merchantId: z.string().optional(),
  secret: z.string().optional(),
  status: z.enum(['active', 'paused', 'disabled']).default('active'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ZapierSubscription = z.infer<typeof zapierSubscriptionSchema>;

export const zapierSubscribeInputSchema = z.object({
  hookUrl: z.string().url('A valid hookUrl is required'),
  event: zapierTriggerTypeSchema,
  targetUrl: z.string().url().optional(),
  merchantId: z.string().optional(),
  secret: z.string().min(16).optional(),
});

export type ZapierSubscribeInput = z.infer<typeof zapierSubscribeInputSchema>;

export const zapierUnsubscribeInputSchema = z.object({
  id: z.string().optional(),
  hookUrl: z.string().url().optional(),
}).refine((data) => data.id || data.hookUrl, {
  message: 'Either id or hookUrl must be provided to unsubscribe',
});

export type ZapierUnsubscribeInput = z.infer<typeof zapierUnsubscribeInputSchema>;

export interface ZapierEventPayload<T = Record<string, unknown>> {
  id: string;
  event: ZapierTriggerType;
  timestamp: string;
  data: T;
  merchantId?: string;
  signature?: string;
}

export interface ZapierDeliveryResult {
  subscriptionId: string;
  hookUrl: string;
  statusCode: number;
  success: boolean;
  latencyMs: number;
  error?: string;
}

// Action Input Schemas
export const zapierCreateInvoiceSchema = z.object({
  merchantId: z.string().default('default-merchant'),
  customerName: z.string().min(1, 'Customer name is required'),
  customerEmail: z.string().email('Valid customer email is required'),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().min(3).max(10).default('USD'),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ZapierCreateInvoiceInput = z.infer<typeof zapierCreateInvoiceSchema>;

export const zapierCreatePaymentLinkSchema = z.object({
  merchantId: z.string().default('default-merchant'),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().min(3).max(10).default('USD'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  redirectUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ZapierCreatePaymentLinkInput = z.infer<typeof zapierCreatePaymentLinkSchema>;

export const zapierIssueRefundSchema = z.object({
  paymentId: z.string().min(1, 'Payment ID is required'),
  amount: z.number().positive().optional(),
  reason: z.string().min(1).default('Requested by customer via Zapier'),
  merchantId: z.string().optional(),
});

export type ZapierIssueRefundInput = z.infer<typeof zapierIssueRefundSchema>;

export const zapierVerifyPaymentSchema = z.object({
  paymentId: z.string().min(1, 'Payment ID is required'),
});

export type ZapierVerifyPaymentInput = z.infer<typeof zapierVerifyPaymentSchema>;
