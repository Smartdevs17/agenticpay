import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesforceClient } from '../salesforce-client.js';

describe('SalesforceClient', () => {
  const originalFetch = global.fetch;
  let client: SalesforceClient;

  beforeEach(() => {
    client = new SalesforceClient({
      instanceUrl: 'https://acme.my.salesforce.com/',
      accessToken: 'token-123',
      apiVersion: '59.0',
      timeoutMs: 1000,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('runs a SOQL query with bearer auth', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        totalSize: 1,
        done: true,
        records: [{ Id: '001', Name: 'Acme' }],
      }),
    } as unknown as Response);

    const records = await client.query('SELECT Id, Name FROM Account');

    expect(records).toEqual([{ Id: '001', Name: 'Acme' }]);
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe(
      'https://acme.my.salesforce.com/services/data/v59.0/query?q=SELECT%20Id%2C%20Name%20FROM%20Account',
    );
    expect(options.headers.Authorization).toBe('Bearer token-123');
  });

  it('creates a record and returns its id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      json: async () => ({ id: 'a0101', success: true, errors: [] }),
    } as unknown as Response);

    const id = await client.create('Account', { Name: 'Acme' });

    expect(id).toBe('a0101');
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe(
      'https://acme.my.salesforce.com/services/data/v59.0/sobjects/Account',
    );
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ Name: 'Acme' });
  });

  it('updates a record with PATCH', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
    } as unknown as Response);

    await client.update('Account', 'a0101', { Name: 'Acme 2' });

    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe(
      'https://acme.my.salesforce.com/services/data/v59.0/sobjects/Account/a0101',
    );
    expect(options.method).toBe('PATCH');
  });

  it('throws on API errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '[{"errorCode":"INVALID_SESSION_ID"}]',
    } as unknown as Response);

    await expect(client.query('SELECT Id FROM Account')).rejects.toThrow(
      /Salesforce API error 401/,
    );
  });

  it('escapes SOQL string literals', () => {
    expect(SalesforceClient.escapeSoql("O'Brien\\Co")).toBe(
      "O\\'Brien\\\\Co",
    );
  });
});
