import { z } from 'zod';

/**
 * Provider-agnostic accounting primitives shared by the Salesforce Billing,
 * Xero and QuickBooks integrations. Keeping the shapes identical lets one
 * caller sync the same invoice to any accounting provider.
 */

export const accountingCustomerSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().optional(),
});

export type AccountingCustomer = z.infer<typeof accountingCustomerSchema>;

export const accountingLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitAmount: z.number().nonnegative(),
  taxType: z.string().optional(),
  accountCode: z.string().optional(),
});

export type AccountingLine = z.infer<typeof accountingLineSchema>;

export const accountingInvoiceSchema = z.object({
  externalId: z.string().min(1),
  reference: z.string().min(1).optional(),
  customer: accountingCustomerSchema,
  currency: z.string().length(3).default('USD'),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  lines: z.array(accountingLineSchema).min(1),
});

export type AccountingInvoice = z.infer<typeof accountingInvoiceSchema>;

export const accountingPaymentSchema = z.object({
  externalId: z.string().min(1),
  invoiceExternalId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  paidAt: z.string().optional(),
  reference: z.string().optional(),
});

export type AccountingPayment = z.infer<typeof accountingPaymentSchema>;

export type SyncAction = 'created' | 'updated' | 'skipped';

export interface InvoiceSyncResult {
  externalId: string;
  providerId: string;
  action: SyncAction;
  customerId: string;
}

export interface PaymentSyncResult {
  externalId: string;
  providerId: string;
  action: SyncAction;
}

export function invoiceTotal(invoice: AccountingInvoice): number {
  return invoice.lines.reduce(
    (total, line) => total + line.quantity * line.unitAmount,
    0,
  );
}

export function toDateString(value: string | undefined, fallback = new Date()): string {
  if (!value) return fallback.toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed.toISOString().slice(0, 10);
}
