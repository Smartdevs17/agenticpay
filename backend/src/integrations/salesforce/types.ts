import type { AccountingInvoice, AccountingPayment } from '../accounting/types.js';

export interface SalesforceConfig {
  instanceUrl: string;
  accessToken: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface SalesforceObjectNames {
  account: string;
  invoice: string;
  invoiceLine: string;
  payment: string;
  externalIdField: string;
}

export const DEFAULT_SALESFORCE_OBJECTS: SalesforceObjectNames = {
  account: 'Account',
  invoice: 'blng__Invoice__c',
  invoiceLine: 'blng__InvoiceLine__c',
  payment: 'blng__Payment__c',
  externalIdField: 'External_Id__c',
};

export interface SalesforceSyncOptions {
  invoiceStatus?: string;
  objects?: Partial<SalesforceObjectNames>;
}

export type SalesforceInvoiceInput = AccountingInvoice;
export type SalesforcePaymentInput = AccountingPayment;

export interface SalesforceRecord {
  Id: string;
  [key: string]: unknown;
}
