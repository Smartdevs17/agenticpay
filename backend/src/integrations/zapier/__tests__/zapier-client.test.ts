import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ZapierClient } from '../zapier-client.js';
import type { ZapierEventPayload } from '../types.js';

describe('ZapierClient', () => {
  let client: ZapierClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new ZapierClient({
      defaultTimeoutMs: 1000,
      maxRetries: 2,
      secret: 'test-shared-secret-1234567890123456',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('generates a valid HMAC-SHA256 signature', () => {
    const payload = JSON.stringify({ hello: 'world' });
    const timestamp = '1700000000';
    const secret = 'my-secret-key-32-bytes-long-super!';

    const sig = client.generateSignature(payload, timestamp, secret);
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);

    // Verify consistency
    const sig2 = client.generateSignature(payload, timestamp, secret);
    expect(sig).toBe(sig2);
  });

  it('successfully dispatches a webhook to Zapier', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    } as unknown as Response);

    const eventPayload: ZapierEventPayload = {
      id: 'evt-123',
      event: 'payment.succeeded',
      timestamp: '2026-09-24T12:00:00Z',
      data: { amount: 100, currency: 'USD' },
    };

    const result = await client.sendWebhook(
      'sub-1',
      'https://hooks.zapier.com/hooks/catch/123/abc',
      eventPayload
    );

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.hookUrl).toBe('https://hooks.zapier.com/hooks/catch/123/abc');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://hooks.zapier.com/hooks/catch/123/abc');
    expect(options.method).toBe('POST');
    expect(options.headers['X-Zapier-Event-Id']).toBe('evt-123');
    expect(options.headers['X-Zapier-Event-Type']).toBe('payment.succeeded');
    expect(options.headers['X-Zapier-Signature']).toMatch(/^sha256=/);
  });

  it('does not retry on 4xx client errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as unknown as Response);

    const eventPayload: ZapierEventPayload = {
      id: 'evt-404',
      event: 'payment.failed',
      timestamp: '2026-09-24T12:00:00Z',
      data: { reason: 'card_declined' },
    };

    const result = await client.sendWebhook(
      'sub-404',
      'https://hooks.zapier.com/hooks/catch/bad/url',
      eventPayload
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx server errors up to maxRetries', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as unknown as Response);

    const eventPayload: ZapierEventPayload = {
      id: 'evt-retry',
      event: 'invoice.paid',
      timestamp: '2026-09-24T12:00:00Z',
      data: { invoiceId: 'inv-123' },
    };

    const result = await client.sendWebhook(
      'sub-retry',
      'https://hooks.zapier.com/hooks/catch/retry/1',
      eventPayload
    );

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
