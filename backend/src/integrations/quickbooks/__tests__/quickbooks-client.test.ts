import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickBooksClient } from '../quickbooks-client.js';

describe('QuickBooksClient', () => {
  const originalFetch = global.fetch;
  let client: QuickBooksClient;

  beforeEach(() => {
    client = new QuickBooksClient({
      accessToken: 'qb-token',
      realmId: 'realm-1',
      timeoutMs: 1000,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('runs a query scoped to the company', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        QueryResponse: { Invoice: [{ Id: '1', DocNumber: 'INV-1' }] },
      }),
    } as unknown as Response);

    const invoices = await client.query<{ Id: string }>(
      'SELECT * FROM Invoice',
    );

    expect(invoices).toEqual([{ Id: '1', DocNumber: 'INV-1' }]);
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toContain(
      'https://quickbooks.api.intuit.com/v3/company/realm-1/query?query=SELECT%20*%20FROM%20Invoice&minorversion=65',
    );
    expect(options.headers.Authorization).toBe('Bearer qb-token');
  });

  it('returns an empty array for an empty query response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ QueryResponse: {} }),
    } as unknown as Response);

    await expect(client.query('SELECT * FROM Customer')).resolves.toEqual([]);
  });

  it('creates an entity with a request id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      json: async () => ({ Invoice: { Id: '99' } }),
    } as unknown as Response);

    const created = await client.create<{ Id: string }>(
      'Invoice',
      { DocNumber: 'INV-1' },
      'req-1',
    );

    expect(created.Id).toBe('99');
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toContain('/Invoice?requestid=req-1&minorversion=65');
    expect(options.method).toBe('POST');
  });

  it('throws on API errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'AuthenticationFailed',
    } as unknown as Response);

    await expect(client.query('SELECT * FROM Invoice')).rejects.toThrow(
      /QuickBooks API error 401/,
    );
  });

  it('escapes query string literals', () => {
    expect(QuickBooksClient.escapeQuery("O'Brien\\Co")).toBe(
      "O\\'Brien\\\\Co",
    );
  });
});
