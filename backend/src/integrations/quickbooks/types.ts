import type { AccountingInvoice, AccountingPayment } from '../accounting/types.js';

export interface QuickBooksConfig {
  accessToken: string;
  realmId: string;
  baseUrl?: string;
  minorVersion?: string;
  timeoutMs?: number;
}

export interface QuickBooksCustomer {
  Id: string;
  DisplayName: string;
  PrimaryEmailAddr?: { Address: string };
}

export interface QuickBooksInvoice {
  Id: string;
  DocNumber?: string;
  CustomerRef?: { value: string };
}

export interface QuickBooksPayment {
  Id: string;
}

export interface QuickBooksSyncOptions {
  defaultItemId?: string;
}

export type QuickBooksInvoiceInput = AccountingInvoice;
export type QuickBooksPaymentInput = AccountingPayment;
