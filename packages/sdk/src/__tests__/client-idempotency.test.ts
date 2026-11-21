import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgenticPayClient } from '../client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgenticPayClient idempotency', () => {
  it('reuses one generated key across automatic retries', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'temporary' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new AgenticPayClient({
      baseUrl: 'https://example.test',
      retry: { attempts: 1, baseDelayMs: 0 },
    });

    await expect(client.post('/payments', { amount: 10 })).resolves.toEqual({ ok: true });
    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders['Idempotency-Key']).toMatch(/^ap_/);
    expect(secondHeaders['Idempotency-Key']).toBe(firstHeaders['Idempotency-Key']);
  });

  it('preserves a caller-provided idempotency key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new AgenticPayClient({ baseUrl: 'https://example.test' });

    await client.post('/payments', {}, { 'idempotency-key': 'payment_123' });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('payment_123');
    expect(headers['Idempotency-Key']).toBeUndefined();
  });
});
