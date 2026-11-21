import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XeroClient } from '../xero-client.js';

describe('XeroClient', () => {
  const originalFetch = global.fetch;
  let client: XeroClient;

  beforeEach(() => {
    client = new XeroClient({
      accessToken: 'xero-token',
      tenantId: 'tenant-1',
      timeoutMs: 1000,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('finds a contact by email with tenant scoping', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        Contacts: [{ ContactID: 'c1', Name: 'Acme', EmailAddress: 'a@b.test' }],
      }),
    } as unknown as Response);

    const contact = await client.findContactByEmail('a@b.test');

    expect(contact?.ContactID).toBe('c1');
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe(
      'https://api.xero.com/api.xro/2.0/Contacts?where=EmailAddress%3D%3D%22a%40b.test%22',
    );
    expect(options.headers['xero-tenant-id']).toBe('tenant-1');
    expect(options.headers.Authorization).toBe('Bearer xero-token');
  });

  it('creates an invoice with an idempotency key', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      json: async () => ({ Invoices: [{ InvoiceID: 'inv-1' }] }),
    } as unknown as Response);

    const invoice = await client.createInvoice(
      { Type: 'ACCREC', Reference: 'INV-1' },
      'idem-1',
    );

    expect(invoice.InvoiceID).toBe('inv-1');
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.xero.com/api.xro/2.0/Invoices');
    expect(options.method).toBe('POST');
    expect(options.headers['Idempotency-Key']).toBe('idem-1');
    expect(JSON.parse(options.body)).toEqual({
      Invoices: [{ Type: 'ACCREC', Reference: 'INV-1' }],
    });
  });

  it('creates a payment with an idempotency key', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      json: async () => ({ Payments: [{ PaymentID: 'pay-1' }] }),
    } as unknown as Response);

    const payment = await client.createPayment(
      { Invoice: { InvoiceID: 'inv-1' }, Amount: 10 },
      'pay-idem',
    );

    expect(payment.PaymentID).toBe('pay-1');
    const [, options] = (global.fetch as any).mock.calls[0];
    expect(options.headers['Idempotency-Key']).toBe('pay-idem');
  });

  it('throws on API errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'Rate limit exceeded',
    } as unknown as Response);

    await expect(client.getContacts()).rejects.toThrow(/Xero API error 429/);
  });
});
