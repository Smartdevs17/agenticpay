import { z } from 'zod';

// Base event schema
export const BaseEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  aggregateId: z.string(),
  aggregateType: z.string(),
  version: z.number().int().positive(),
  payload: z.any(),
  metadata: z.object({
    correlationId: z.string().uuid().optional(),
    causationId: z.string().uuid().optional(),
    userId: z.string().optional(),
    ipAddress: z.string().ip().optional(),
    userAgent: z.string().optional(),
  }),
  occurredAt: z.string().datetime(),
});

// Payment domain events
export const PaymentCreatedSchema = z.object({
  paymentId: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  amount: z.number().positive(),
  asset: z.string(),
  trigger: z.object({
    type: z.enum(['immediate', 'scheduled', 'conditional']),
    executeAt: z.string().datetime().optional(),
  }),
  memo: z.string().optional(),
});

export const PaymentExecutedSchema = z.object({
  paymentId: z.string().uuid(),
  transactionHash: z.string(),
  amount: z.number().positive(),
  asset: z.string(),
  fee: z.number().nonnegative().optional(),
  executedAt: z.string().datetime(),
});

export const PaymentFailedSchema = z.object({
  paymentId: z.string().uuid(),
  reason: z.enum(['insufficient_funds', 'network_error', 'timeout', 'invalid_recipient', 'other']),
  error: z.string(),
  retryable: z.boolean(),
  retryCount: z.number().int().nonnegative(),
});

export const PaymentCancelledSchema = z.object({
  paymentId: z.string().uuid(),
  cancelledBy: z.string(),
  cancelledAt: z.string().datetime(),
  reason: z.string().optional(),
});

// Invoice domain events
export const InvoiceGeneratedSchema = z.object({
  invoiceId: z.string().uuid(),
  paymentId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string(),
  dueDate: z.string().datetime(),
  status: z.enum(['pending', 'paid', 'overdue', 'cancelled']),
});

// Receipt domain events
export const ReceiptMintedSchema = z.object({
  tokenId: z.string(),
  paymentId: z.string().uuid(),
  sender: z.string(),
  recipient: z.string(),
  amount: z.number().positive(),
  asset: z.string(),
  mintedAt: z.string().datetime(),
  metadata: z.record(z.any()).optional(),
});

export const ReceiptTransferredSchema = z.object({
  tokenId: z.string(),
  from: z.string(),
  to: z.string(),
  transferredAt: z.string().datetime(),
});

export const ReceiptBurnedSchema = z.object({
  tokenId: z.string(),
  burnedBy: z.string(),
  burnedAt: z.string().datetime(),
  reason: z.string().optional(),
});

// Refund domain events
export const RefundRequestedSchema = z.object({
  refundId: z.string().uuid(),
  paymentId: z.string().uuid(),
  amount: z.number().positive(),
  reason: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string().datetime(),
});

export const RefundApprovedSchema = z.object({
  refundId: z.string().uuid(),
  approvedBy: z.string(),
  approvedAt: z.string().datetime(),
  transactionHash: z.string().optional(),
});

export const RefundRejectedSchema = z.object({
  refundId: z.string().uuid(),
  rejectedBy: z.string(),
  rejectedAt: z.string().datetime(),
  reason: z.string(),
});

// Split payment domain events
export const SplitCreatedSchema = z.object({
  splitId: z.string().uuid(),
  totalAmount: z.number().positive(),
  asset: z.string(),
  recipients: z.array(z.object({
    address: z.string(),
    amount: z.number().positive(),
    percentage: z.number().min(0).max(100),
  })),
  createdBy: z.string(),
});

export const SplitExecutedSchema = z.object({
  splitId: z.string().uuid(),
  transactionHash: z.string(),
  executedAt: z.string().datetime(),
  totalAmount: z.number().positive(),
  asset: z.string(),
});

// Event type to schema mapping
export const PaymentEventSchemas = {
  'payment.created': PaymentCreatedSchema,
  'payment.executed': PaymentExecutedSchema,
  'payment.failed': PaymentFailedSchema,
  'payment.cancelled': PaymentCancelledSchema,
  'invoice.generated': InvoiceGeneratedSchema,
  'receipt.minted': ReceiptMintedSchema,
  'receipt.transferred': ReceiptTransferredSchema,
  'receipt.burned': ReceiptBurnedSchema,
  'refund.requested': RefundRequestedSchema,
  'refund.approved': RefundApprovedSchema,
  'refund.rejected': RefundRejectedSchema,
  'split.created': SplitCreatedSchema,
  'split.executed': SplitExecutedSchema,
} as const;
