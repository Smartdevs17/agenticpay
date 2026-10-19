import { XeroClient } from './xero-client.js';
import type {
  XeroConfig,
  XeroInvoiceInput,
  XeroPaymentInput,
  XeroSyncOptions,
} from './types.js';
import {
  accountingInvoiceSchema,
  accountingPaymentSchema,
  toDateString,
  type InvoiceSyncResult,
  type PaymentSyncResult,
} from '../accounting/types.js';

/**
 * Syncs AgenticPay invoices and payments into Xero.
 *
 * Invoices are matched by their `Reference` field and payments are submitted
 * with the payment external id as the Xero idempotency key, making retries safe.
 */
export class XeroService {
  private client: XeroClient | null = null;
  private readonly defaultAccountCode?: string;
  private readonly paymentAccountCode?: string;
  private readonly invoiceStatus: string;

  constructor(client?: XeroClient, options: XeroSyncOptions = {}) {
    if (client) this.client = client;
    this.defaultAccountCode =
      options.defaultAccountCode ?? process.env.XERO_DEFAULT_ACCOUNT_CODE;
    this.paymentAccountCode =
      options.paymentAccountCode ?? process.env.XERO_PAYMENT_ACCOUNT_CODE;
    this.invoiceStatus =
      options.invoiceStatus ?? process.env.XERO_INVOICE_STATUS ?? 'AUTHORISED';
  }

  getClient(): XeroClient {
    if (!this.client) {
      const accessToken = process.env.XERO_ACCESS_TOKEN;
      const tenantId = process.env.XERO_TENANT_ID;

      if (!accessToken || !tenantId) {
        throw new Error('XERO_ACCESS_TOKEN and XERO_TENANT_ID must be configured');
      }

      const config: XeroConfig = {
        accessToken,
        tenantId,
        baseUrl: process.env.XERO_API_URL,
      };
      this.client = new XeroClient(config);
    }
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(
      this.client ||
        (process.env.XERO_ACCESS_TOKEN && process.env.XERO_TENANT_ID),
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.getClient().getContacts();
      return true;
    } catch {
      return false;
    }
  }

  async syncInvoice(input: XeroInvoiceInput): Promise<InvoiceSyncResult> {
    const invoice = accountingInvoiceSchema.parse(input);
    const client = this.getClient();
    const reference = invoice.reference ?? invoice.externalId;

    const contact = await this.ensureContact(invoice);
    const existing = await client.findInvoiceByReference(reference);

    if (existing) {
      return {
        externalId: invoice.externalId,
        providerId: existing.InvoiceID,
        action: 'skipped',
        customerId: contact.ContactID,
      };
    }

    const created = await client.createInvoice(
      {
        Type: 'ACCREC',
        Contact: { ContactID: contact.ContactID },
        Date: toDateString(invoice.invoiceDate),
        DueDate: toDateString(
          invoice.dueDate,
          new Date(invoice.invoiceDate ?? Date.now()),
        ),
        LineAmountTypes: 'Exclusive',
        Reference: reference,
        CurrencyCode: invoice.currency,
        Status: this.invoiceStatus,
        LineItems: invoice.lines.map((line) => ({
          Description: line.description,
          Quantity: line.quantity,
          UnitAmount: line.unitAmount,
          ...(line.accountCode || this.defaultAccountCode
            ? { AccountCode: line.accountCode ?? this.defaultAccountCode }
            : {}),
          ...(line.taxType ? { TaxType: line.taxType } : {}),
        })),
      },
      invoice.externalId,
    );

    return {
      externalId: invoice.externalId,
      providerId: created.InvoiceID,
      action: 'created',
      customerId: contact.ContactID,
    };
  }

  async recordPayment(input: XeroPaymentInput): Promise<PaymentSyncResult> {
    const payment = accountingPaymentSchema.parse(input);
    const client = this.getClient();

    if (!this.paymentAccountCode) {
      throw new Error(
        'XERO_PAYMENT_ACCOUNT_CODE (or paymentAccountCode option) is required to record Xero payments',
      );
    }

    const invoice = await client.findInvoiceByReference(
      payment.invoiceExternalId,
    );
    if (!invoice) {
      throw new Error(
        `Xero invoice ${payment.invoiceExternalId} was not found`,
      );
    }

    const created = await client.createPayment(
      {
        Invoice: { InvoiceID: invoice.InvoiceID },
        Account: { Code: this.paymentAccountCode },
        Date: toDateString(payment.paidAt),
        Amount: payment.amount,
        Reference: payment.reference ?? payment.externalId,
      },
      payment.externalId,
    );

    return {
      externalId: payment.externalId,
      providerId: created.PaymentID,
      action: 'created',
    };
  }

  private async ensureContact(invoice: XeroInvoiceInput) {
    const client = this.getClient();
    const { customer } = invoice;

    const existing = customer.email
      ? await client.findContactByEmail(customer.email)
      : await client.findContactByName(customer.name);

    if (existing) return existing;

    return client.createContact({
      Name: customer.name,
      ...(customer.email ? { EmailAddress: customer.email } : {}),
    });
  }
}

export const xeroService = new XeroService();
