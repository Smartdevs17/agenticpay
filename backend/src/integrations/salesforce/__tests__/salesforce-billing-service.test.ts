import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesforceBillingService } from '../salesforce-billing-service.js';
import type { SalesforceClient } from '../salesforce-client.js';

const invoice = {
  externalId: 'inv_123',
  reference: 'INV-123',
  customer: {
    externalId: 'cus_123',
    name: 'Acme Corp',
    email: 'billing@acme.test',
  },
  currency: 'USD',
  invoiceDate: '2026-10-01',
  dueDate: '2026-11-01',
  lines: [
    { description: 'Platform fee', quantity: 2, unitAmount: 50 },
    { description: 'Support', quantity: 1, unitAmount: 25.5 },
  ],
};

describe('SalesforceBillingService', () => {
  let client: SalesforceClient;
  let service: SalesforceBillingService;

  beforeEach(() => {
    client = {
      query: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue('created_id'),
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as SalesforceClient;

    service = new SalesforceBillingService(client, {
      accountEmailField: 'PersonEmail',
    });
  });

  it('creates the account, invoice and lines on first sync', async () => {
    (client.findOne as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    (client.create as any)
      .mockResolvedValueOnce('account_1')
      .mockResolvedValueOnce('invoice_1')
      .mockResolvedValueOnce('line_1')
      .mockResolvedValueOnce('line_2');

    const result = await service.syncInvoice(invoice);

    expect(result).toEqual({
      externalId: 'inv_123',
      providerId: 'invoice_1',
      customerId: 'account_1',
      action: 'created',
    });
    expect(client.create).toHaveBeenNthCalledWith(
      1,
      'Account',
      expect.objectContaining({
        External_Id__c: 'cus_123',
        Name: 'Acme Corp',
        PersonEmail: 'billing@acme.test',
      }),
    );
    expect(client.create).toHaveBeenNthCalledWith(
      2,
      'blng__Invoice__c',
      expect.objectContaining({
        External_Id__c: 'inv_123',
        blng__Account__c: 'account_1',
        blng__TotalAmount__c: 125.5,
        CurrencyIsoCode: 'USD',
      }),
    );
    expect(client.create).toHaveBeenNthCalledWith(
      3,
      'blng__InvoiceLine__c',
      expect.objectContaining({ blng__Amount__c: 100 }),
    );
    expect(client.create).toHaveBeenNthCalledWith(
      4,
      'blng__InvoiceLine__c',
      expect.objectContaining({ blng__Amount__c: 25.5 }),
    );
  });

  it('updates an existing invoice and its existing lines', async () => {
    (client.findOne as any)
      .mockResolvedValueOnce({ Id: 'account_1' })
      .mockResolvedValueOnce({ Id: 'invoice_1' });
    (client.query as any).mockResolvedValueOnce([
      { Id: 'line_1' },
      { Id: 'line_2' },
    ]);

    const result = await service.syncInvoice(invoice);

    expect(result.action).toBe('updated');
    expect(client.update).toHaveBeenCalledWith(
      'Account',
      'account_1',
      expect.objectContaining({ Name: 'Acme Corp' }),
    );
    expect(client.update).toHaveBeenCalledWith(
      'blng__Invoice__c',
      'invoice_1',
      expect.objectContaining({ External_Id__c: 'inv_123' }),
    );
    expect(client.update).toHaveBeenCalledWith(
      'blng__InvoiceLine__c',
      'line_1',
      expect.objectContaining({ blng__Description__c: 'Platform fee' }),
    );
    expect(client.create).not.toHaveBeenCalled();
  });

  it('records a payment against a synced invoice', async () => {
    (client.findOne as any)
      .mockResolvedValueOnce({ Id: 'invoice_1' })
      .mockResolvedValueOnce(null);

    const result = await service.recordPayment({
      externalId: 'pay_1',
      invoiceExternalId: 'inv_123',
      amount: 125.5,
      currency: 'USD',
      paidAt: '2026-10-15',
      reference: 'tx_1',
    });

    expect(result).toEqual({
      externalId: 'pay_1',
      providerId: 'created_id',
      action: 'created',
    });
    expect(client.create).toHaveBeenCalledWith(
      'blng__Payment__c',
      expect.objectContaining({
        External_Id__c: 'pay_1',
        blng__Invoice__c: 'invoice_1',
        blng__Amount__c: 125.5,
        blng__Reference__c: 'tx_1',
      }),
    );
  });

  it('skips an already recorded payment', async () => {
    (client.findOne as any)
      .mockResolvedValueOnce({ Id: 'invoice_1' })
      .mockResolvedValueOnce({ Id: 'payment_1' });

    const result = await service.recordPayment({
      externalId: 'pay_1',
      invoiceExternalId: 'inv_123',
      amount: 10,
      currency: 'USD',
    });

    expect(result).toEqual({
      externalId: 'pay_1',
      providerId: 'payment_1',
      action: 'skipped',
    });
    expect(client.create).not.toHaveBeenCalled();
  });

  it('fails when the invoice for a payment is missing', async () => {
    (client.findOne as any).mockResolvedValueOnce(null);

    await expect(
      service.recordPayment({
        externalId: 'pay_1',
        invoiceExternalId: 'missing',
        amount: 10,
        currency: 'USD',
      }),
    ).rejects.toThrow(/was not found/);
  });
});
