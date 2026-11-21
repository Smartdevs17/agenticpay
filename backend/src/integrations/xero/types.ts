import type { AccountingInvoice, AccountingPayment } from '../accounting/types.js';

export interface XeroConfig {
  accessToken: string;
  tenantId: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface XeroContact {
  ContactID: string;
  Name: string;
  EmailAddress?: string;
}

export interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber?: string;
  Reference?: string;
  Status?: string;
}

export interface XeroPayment {
  PaymentID: string;
  Invoice?: { InvoiceID: string };
  Amount?: number;
  Date?: string;
  Reference?: string;
}

export interface XeroSyncOptions {
  defaultAccountCode?: string;
  paymentAccountCode?: string;
  invoiceStatus?: string;
}

export type XeroInvoiceInput = AccountingInvoice;
export type XeroPaymentInput = AccountingPayment;
