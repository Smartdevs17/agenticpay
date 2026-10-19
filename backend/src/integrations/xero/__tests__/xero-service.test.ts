import { beforeEach, describe, expect, it, vi } from 'vitest';
import { XeroService } from '../xero-service.js';
import type { XeroClient } from '../xero-client.js';

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

describe('XeroService', () => {
  let client: XeroClient;
  let service: XeroService;

  beforeEach(() => {
    client = {
      findContactByEmail: vi.fn(),
      findContactByName: vi.fn(),
      createContact: vi.fn(),
      findInvoiceByReference: vi.fn(),
      createInvoice: vi.fn(),
      createPayment: vi.fn(),
      getContacts: vi.fn(),
    } as unknown as XeroClient;

    service = new XeroService(client, {
      defaultAccountCode: '200',
      paymentAccountCode: '090',
    });
  });

  it('creates the contact and invoice on first sync', async () => {
    (client.findContactByEmail as any).mockResolvedValue(null);
    (client.createContact as any).mockResolvedValue({
      ContactID: 'contact_1',
      Name: 'Acme Corp',
    });
    (client.findInvoiceByReference as any).mockResolvedValue(null);
    (client.createInvoice as any).mockResolvedValue({ InvoiceID: 'invoice_1' });

    const result = await service.syncInvoice(invoice);

    expect(result).toEqual({
      externalId: 'inv_123',
      providerId: 'invoice_1',
      action: 'created',
      customerId: 'contact_1',
    });
    expect(client.createContact).toHaveBeenCalledWith({
      Name: 'Acme Corp',
      EmailAddress: 'billing@acme.test',
    });
    expect(client.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        Type: 'ACCREC',
        Contact: { ContactID: 'contact_1' },
        Reference: 'INV-123',
        CurrencyCode: 'USD',
        LineItems: [
          expect.objectContaining({
            Description: 'Platform fee',
            AccountCode: '200',
          }),
        ],
      }),
      'inv_123',
    );
  });

  it('skips an invoice that already exists', async () => {
    (client.findContactByEmail as any).mockResolvedValue({
      ContactID: 'contact_1',
      Name: 'Acme Corp',
    });
    (client.findInvoiceByReference as any).mockResolvedValue({
      InvoiceID: 'invoice_1',
    });

    const result = await service.syncInvoice(invoice);

    expect(result.action).toBe('skipped');
    expect(result.providerId).toBe('invoice_1');
    expect(client.createInvoice).not.toHaveBeenCalled();
  });

  it('falls back to contact name when no email is present', async () => {
    (client.findContactByName as any).mockResolvedValue({
      ContactID: 'contact_2',
      Name: 'Acme Corp',
    });
    (client.findInvoiceByReference as any).mockResolvedValue(null);
    (client.createInvoice as any).mockResolvedValue({ InvoiceID: 'invoice_1' });

    await service.syncInvoice({
      ...invoice,
      customer: { externalId: 'cus_123', name: 'Acme Corp' },
    });

    expect(client.findContactByName).toHaveBeenCalledWith('Acme Corp');
    expect(client.createContact).not.toHaveBeenCalled();
  });

  it('records a payment against the invoice reference', async () => {
    (client.findInvoiceByReference as any).mockResolvedValue({
      InvoiceID: 'invoice_1',
    });
    (client.createPayment as any).mockResolvedValue({ PaymentID: 'payment_1' });

    const result = await service.recordPayment({
      externalId: 'pay_1',
      invoiceExternalId: 'INV-123',
      amount: 100,
      currency: 'USD',
      paidAt: '2026-10-15',
      reference: 'tx_1',
    });

    expect(result).toEqual({
      externalId: 'pay_1',
      providerId: 'payment_1',
      action: 'created',
    });
    expect(client.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        Invoice: { InvoiceID: 'invoice_1' },
        Account: { Code: '090' },
        Amount: 100,
        Date: '2026-10-15',
        Reference: 'tx_1',
      }),
      'pay_1',
    );
  });

  it('fails when the invoice is missing', async () => {
    (client.findInvoiceByReference as any).mockResolvedValue(null);

    await expect(
      service.recordPayment({
        externalId: 'pay_1',
        invoiceExternalId: 'missing',
        amount: 10,
        currency: 'USD',
      }),
    ).rejects.toThrow(/was not found/);
  });

  it('requires a payment account code', async () => {
    const unconfigured = new XeroService(client);

    await expect(
      unconfigured.recordPayment({
        externalId: 'pay_1',
        invoiceExternalId: 'INV-123',
        amount: 10,
        currency: 'USD',
      }),
    ).rejects.toThrow(/PAYMENT_ACCOUNT_CODE/);
  });
});
