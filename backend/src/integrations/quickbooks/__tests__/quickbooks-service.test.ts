import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickBooksService } from '../quickbooks-service.js';
import type { QuickBooksClient } from '../quickbooks-client.js';

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
  lines: [{ description: 'Platform fee', quantity: 1, unitAmount: 100 }],
};

describe('QuickBooksService', () => {
  let client: QuickBooksClient;
  let service: QuickBooksService;

  beforeEach(() => {
    client = {
      query: vi.fn(),
      create: vi.fn(),
      getInvoice: vi.fn(),
    } as unknown as QuickBooksClient;

    service = new QuickBooksService(client, { defaultItemId: 'item-1' });
  });

  it('creates the customer and invoice on first sync', async () => {
    (client.query as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (client.create as any)
      .mockResolvedValueOnce({ Id: 'cust_1', DisplayName: 'Acme Corp' })
      .mockResolvedValueOnce({ Id: 'inv_1', DocNumber: 'INV-123' });

    const result = await service.syncInvoice(invoice);

    expect(result).toEqual({
      externalId: 'inv_123',
      providerId: 'inv_1',
      action: 'created',
      customerId: 'cust_1',
    });
    expect(client.create).toHaveBeenNthCalledWith(1, 'Customer', {
      DisplayName: 'Acme Corp',
      PrimaryEmailAddr: { Address: 'billing@acme.test' },
    });
    expect(client.create).toHaveBeenNthCalledWith(
      2,
      'Invoice',
      expect.objectContaining({
        CustomerRef: { value: 'cust_1' },
        DocNumber: 'INV-123',
        Line: [
          expect.objectContaining({
            Amount: 100,
            SalesItemLineDetail: expect.objectContaining({
              Qty: 1,
              UnitPrice: 100,
              ItemRef: { value: 'item-1' },
            }),
          }),
        ],
      }),
      'inv_123',
    );
  });

  it('reuses an existing customer matched by name', async () => {
    (client.query as any)
      .mockResolvedValueOnce([{ Id: 'cust_1', DisplayName: 'Acme Corp' }])
      .mockResolvedValueOnce([]);
    (client.create as any).mockResolvedValueOnce({ Id: 'inv_1' });

    await service.syncInvoice(invoice);

    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.create).toHaveBeenCalledWith(
      'Invoice',
      expect.objectContaining({ CustomerRef: { value: 'cust_1' } }),
      'inv_123',
    );
  });

  it('skips an invoice that already exists', async () => {
    (client.query as any)
      .mockResolvedValueOnce([{ Id: 'cust_1', DisplayName: 'Acme Corp' }])
      .mockResolvedValueOnce([{ Id: 'inv_1' }]);

    const result = await service.syncInvoice(invoice);

    expect(result.action).toBe('skipped');
    expect(client.create).not.toHaveBeenCalled();
  });

  it('records a payment linked to the invoice', async () => {
    (client.query as any).mockResolvedValueOnce([
      { Id: 'inv_1', CustomerRef: { value: 'cust_1' } },
    ]);
    (client.create as any).mockResolvedValueOnce({ Id: 'pay_1' });

    const result = await service.recordPayment({
      externalId: 'pay_1',
      invoiceExternalId: 'INV-123',
      amount: 100,
      currency: 'USD',
      reference: 'tx_1',
    });

    expect(result).toEqual({
      externalId: 'pay_1',
      providerId: 'pay_1',
      action: 'created',
    });
    expect(client.create).toHaveBeenCalledWith(
      'Payment',
      expect.objectContaining({
        CustomerRef: { value: 'cust_1' },
        TotalAmt: 100,
        Line: [
          { Amount: 100, LinkedTxn: [{ TxnId: 'inv_1', TxnType: 'Invoice' }] },
        ],
      }),
      'pay_1',
    );
  });

  it('fails when the invoice is missing', async () => {
    (client.query as any).mockResolvedValueOnce([]);

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
