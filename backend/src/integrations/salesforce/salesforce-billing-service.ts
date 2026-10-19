import { SalesforceClient } from './salesforce-client.js';
import {
  DEFAULT_SALESFORCE_OBJECTS,
  type SalesforceInvoiceInput,
  type SalesforceObjectNames,
  type SalesforcePaymentInput,
  type SalesforceRecord,
  type SalesforceSyncOptions,
} from './types.js';
import {
  accountingInvoiceSchema,
  accountingPaymentSchema,
  invoiceTotal,
  toDateString,
  type InvoiceSyncResult,
  type PaymentSyncResult,
} from '../accounting/types.js';

const escape = SalesforceClient.escapeSoql;

/**
 * Syncs AgenticPay invoices and payments into Salesforce Billing.
 *
 * All writes are keyed by a configurable external id field so repeated syncs
 * are idempotent. Account and invoice records are updated in place; invoice
 * lines are reconciled positionally.
 */
export class SalesforceBillingService {
  private client: SalesforceClient | null = null;
  private readonly objects: SalesforceObjectNames;
  private readonly invoiceStatus: string;
  private readonly accountEmailField?: string;

  constructor(
    client?: SalesforceClient,
    options: SalesforceSyncOptions & { accountEmailField?: string } = {},
  ) {
    if (client) this.client = client;
    this.objects = { ...DEFAULT_SALESFORCE_OBJECTS, ...options.objects };
    this.invoiceStatus =
      options.invoiceStatus ?? process.env.SALESFORCE_INVOICE_STATUS ?? 'Draft';
    this.accountEmailField =
      options.accountEmailField ?? process.env.SALESFORCE_ACCOUNT_EMAIL_FIELD;
  }

  getClient(): SalesforceClient {
    if (!this.client) {
      const instanceUrl = process.env.SALESFORCE_INSTANCE_URL;
      const accessToken = process.env.SALESFORCE_ACCESS_TOKEN;

      if (!instanceUrl || !accessToken) {
        throw new Error(
          'SALESFORCE_INSTANCE_URL and SALESFORCE_ACCESS_TOKEN must be configured',
        );
      }

      this.client = new SalesforceClient({
        instanceUrl,
        accessToken,
        apiVersion: process.env.SALESFORCE_API_VERSION,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(
      this.client ||
        (process.env.SALESFORCE_INSTANCE_URL &&
          process.env.SALESFORCE_ACCESS_TOKEN),
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.getClient().query('SELECT Id FROM Account LIMIT 1');
      return true;
    } catch {
      return false;
    }
  }

  async syncInvoice(input: SalesforceInvoiceInput): Promise<InvoiceSyncResult> {
    const invoice = accountingInvoiceSchema.parse(input);
    const client = this.getClient();

    const customerId = await this.upsertAccount(invoice);

    const existing = await client.findOne(
      this.objects.invoice,
      `${this.objects.externalIdField} = '${escape(invoice.externalId)}'`,
    );

    const record: Record<string, unknown> = {
      [this.objects.externalIdField]: invoice.externalId,
      Name: invoice.reference ?? invoice.externalId,
      blng__Account__c: customerId,
      blng__InvoiceDate__c: toDateString(invoice.invoiceDate),
      blng__DueDate__c: toDateString(invoice.dueDate, new Date(invoice.invoiceDate ?? Date.now())),
      blng__InvoiceStatus__c: this.invoiceStatus,
      blng__TotalAmount__c: invoiceTotal(invoice),
      CurrencyIsoCode: invoice.currency,
    };

    let providerId: string;
    let action: 'created' | 'updated';

    if (existing) {
      providerId = existing.Id;
      await client.update(this.objects.invoice, providerId, record);
      action = 'updated';
    } else {
      providerId = await client.create(this.objects.invoice, record);
      action = 'created';
    }

    await this.syncInvoiceLines(invoice, providerId);

    return {
      externalId: invoice.externalId,
      providerId,
      action,
      customerId,
    };
  }

  async recordPayment(
    input: SalesforcePaymentInput,
  ): Promise<PaymentSyncResult> {
    const payment = accountingPaymentSchema.parse(input);
    const client = this.getClient();

    const invoice = await client.findOne(
      this.objects.invoice,
      `${this.objects.externalIdField} = '${escape(payment.invoiceExternalId)}'`,
    );

    if (!invoice) {
      throw new Error(
        `Salesforce invoice ${payment.invoiceExternalId} was not found`,
      );
    }

    const existing = await client.findOne(
      this.objects.payment,
      `${this.objects.externalIdField} = '${escape(payment.externalId)}'`,
    );

    if (existing) {
      return {
        externalId: payment.externalId,
        providerId: existing.Id,
        action: 'skipped',
      };
    }

    const providerId = await client.create(this.objects.payment, {
      [this.objects.externalIdField]: payment.externalId,
      blng__Invoice__c: invoice.Id,
      blng__Amount__c: payment.amount,
      blng__PaymentDate__c: toDateString(payment.paidAt),
      blng__Reference__c: payment.reference ?? payment.externalId,
      CurrencyIsoCode: payment.currency,
    });

    return {
      externalId: payment.externalId,
      providerId,
      action: 'created',
    };
  }

  private async upsertAccount(
    invoice: SalesforceInvoiceInput & { currency: string },
  ): Promise<string> {
    const client = this.getClient();
    const customer = invoice.customer;
    const existing = await client.findOne(
      this.objects.account,
      `${this.objects.externalIdField} = '${escape(customer.externalId)}'`,
    );

    const record: Record<string, unknown> = {
      [this.objects.externalIdField]: customer.externalId,
      Name: customer.name,
    };

    if (customer.email && this.accountEmailField) {
      record[this.accountEmailField] = customer.email;
    }

    if (existing) {
      await client.update(this.objects.account, existing.Id, record);
      return existing.Id;
    }

    return client.create(this.objects.account, record);
  }

  private async syncInvoiceLines(
    invoice: SalesforceInvoiceInput & { currency: string },
    invoiceId: string,
  ): Promise<void> {
    const client = this.getClient();
    const existing = await client.query<SalesforceRecord>(
      `SELECT Id FROM ${this.objects.invoiceLine} WHERE blng__Invoice__c = '${escape(invoiceId)}' ORDER BY CreatedDate ASC`,
    );

    for (let index = 0; index < invoice.lines.length; index += 1) {
      const line = invoice.lines[index];
      const record = {
        blng__Invoice__c: invoiceId,
        blng__Description__c: line.description,
        blng__Quantity__c: line.quantity,
        blng__UnitPrice__c: line.unitAmount,
        blng__Amount__c: line.quantity * line.unitAmount,
      };

      const existingLine = existing[index];
      if (existingLine) {
        await client.update(this.objects.invoiceLine, existingLine.Id, record);
      } else {
        await client.create(this.objects.invoiceLine, record);
      }
    }
  }
}

export const salesforceBillingService = new SalesforceBillingService();
