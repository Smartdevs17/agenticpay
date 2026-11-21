import { QuickBooksClient } from './quickbooks-client.js';
import type {
  QuickBooksCustomer,
  QuickBooksConfig,
  QuickBooksInvoice,
  QuickBooksInvoiceInput,
  QuickBooksPayment,
  QuickBooksPaymentInput,
  QuickBooksSyncOptions,
} from './types.js';
import {
  accountingInvoiceSchema,
  accountingPaymentSchema,
  toDateString,
  type InvoiceSyncResult,
  type PaymentSyncResult,
} from '../accounting/types.js';

const escape = QuickBooksClient.escapeQuery;

/**
 * Syncs AgenticPay invoices and payments into QuickBooks Online.
 *
 * Customers are matched by display name (falling back to email) and invoices
 * by `DocNumber`. Payments use the payment external id as the QuickBooks
 * `requestid`, so retried requests are idempotent.
 */
export class QuickBooksService {
  private client: QuickBooksClient | null = null;
  private readonly defaultItemId?: string;

  constructor(client?: QuickBooksClient, options: QuickBooksSyncOptions = {}) {
    if (client) this.client = client;
    this.defaultItemId =
      options.defaultItemId ?? process.env.QUICKBOOKS_DEFAULT_ITEM_ID;
  }

  getClient(): QuickBooksClient {
    if (!this.client) {
      const accessToken = process.env.QUICKBOOKS_ACCESS_TOKEN;
      const realmId = process.env.QUICKBOOKS_REALM_ID;

      if (!accessToken || !realmId) {
        throw new Error(
          'QUICKBOOKS_ACCESS_TOKEN and QUICKBOOKS_REALM_ID must be configured',
        );
      }

      const config: QuickBooksConfig = {
        accessToken,
        realmId,
        baseUrl: process.env.QUICKBOOKS_API_URL,
      };
      this.client = new QuickBooksClient(config);
    }
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(
      this.client ||
        (process.env.QUICKBOOKS_ACCESS_TOKEN && process.env.QUICKBOOKS_REALM_ID),
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.getClient().query('SELECT * FROM CompanyInfo');
      return true;
    } catch {
      return false;
    }
  }

  async syncInvoice(
    input: QuickBooksInvoiceInput,
  ): Promise<InvoiceSyncResult> {
    const invoice = accountingInvoiceSchema.parse(input);
    const client = this.getClient();
    const reference = invoice.reference ?? invoice.externalId;

    const customer = await this.ensureCustomer(invoice);
    const existing = await client.query<QuickBooksInvoice>(
      `SELECT * FROM Invoice WHERE DocNumber = '${escape(reference)}'`,
    );

    if (existing[0]) {
      return {
        externalId: invoice.externalId,
        providerId: existing[0].Id,
        action: 'skipped',
        customerId: customer.Id,
      };
    }

    const created = await client.create<QuickBooksInvoice>(
      'Invoice',
      {
        CustomerRef: { value: customer.Id },
        DocNumber: reference,
        TxnDate: toDateString(invoice.invoiceDate),
        DueDate: toDateString(
          invoice.dueDate,
          new Date(invoice.invoiceDate ?? Date.now()),
        ),
        CurrencyRef: { value: invoice.currency },
        Line: invoice.lines.map((line) => ({
          DetailType: 'SalesItemLineDetail',
          Amount: line.quantity * line.unitAmount,
          Description: line.description,
          SalesItemLineDetail: {
            Qty: line.quantity,
            UnitPrice: line.unitAmount,
            ...(this.defaultItemId
              ? { ItemRef: { value: this.defaultItemId } }
              : {}),
          },
        })),
      },
      invoice.externalId,
    );

    return {
      externalId: invoice.externalId,
      providerId: created.Id,
      action: 'created',
      customerId: customer.Id,
    };
  }

  async recordPayment(
    input: QuickBooksPaymentInput,
  ): Promise<PaymentSyncResult> {
    const payment = accountingPaymentSchema.parse(input);
    const client = this.getClient();

    const invoices = await client.query<QuickBooksInvoice>(
      `SELECT * FROM Invoice WHERE DocNumber = '${escape(payment.invoiceExternalId)}'`,
    );
    const invoice = invoices[0];

    if (!invoice) {
      throw new Error(
        `QuickBooks invoice ${payment.invoiceExternalId} was not found`,
      );
    }

    const customerId = invoice.CustomerRef?.value;
    if (!customerId) {
      throw new Error(
        `QuickBooks invoice ${invoice.Id} has no linked customer`,
      );
    }

    const created = await client.create<QuickBooksPayment>(
      'Payment',
      {
        CustomerRef: { value: customerId },
        TotalAmt: payment.amount,
        CurrencyRef: { value: payment.currency },
        Line: [
          {
            Amount: payment.amount,
            LinkedTxn: [{ TxnId: invoice.Id, TxnType: 'Invoice' }],
          },
        ],
        PaymentRefNum: payment.reference ?? payment.externalId,
      },
      payment.externalId,
    );

    return {
      externalId: payment.externalId,
      providerId: created.Id,
      action: 'created',
    };
  }

  private async ensureCustomer(
    invoice: QuickBooksInvoiceInput,
  ): Promise<QuickBooksCustomer> {
    const client = this.getClient();
    const { customer } = invoice;

    const byName = await client.query<QuickBooksCustomer>(
      `SELECT * FROM Customer WHERE DisplayName = '${escape(customer.name)}'`,
    );
    if (byName[0]) return byName[0];

    if (customer.email) {
      const byEmail = await client.query<QuickBooksCustomer>(
        `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${escape(customer.email)}'`,
      );
      if (byEmail[0]) return byEmail[0];
    }

    return client.create<QuickBooksCustomer>('Customer', {
      DisplayName: customer.name,
      ...(customer.email
        ? { PrimaryEmailAddr: { Address: customer.email } }
        : {}),
    });
  }
}

export const quickBooksService = new QuickBooksService();
