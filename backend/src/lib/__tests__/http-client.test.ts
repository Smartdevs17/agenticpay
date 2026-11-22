import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient, HttpError, createHttpClient } from '../http-client.js';

describe('HttpClient (Issue #1408)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('successfully makes GET request and parses JSON response', async () => {
    const mockData = { id: 123, status: 'ok' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockData,
    } as unknown as Response);

    const client = createHttpClient({ baseUrl: 'https://api.example.com' });
    const result = await client.get<{ id: number; status: string }>('/resource');

    expect(result).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.example.com/resource');
    expect(init.method).toBe('GET');
  });

  it('maps non-2xx status to HttpError preserving status, statusText, and response body', async () => {
    const errorBody = { code: 'INVALID_INPUT', error: 'Field missing' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify(errorBody),
    } as unknown as Response);

    const client = createHttpClient({ baseUrl: 'https://api.example.com' });

    let thrownError: unknown;
    try {
      await client.post('/submit', { test: true });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(HttpError);
    const httpErr = thrownError as HttpError;
    expect(httpErr.status).toBe(400);
    expect(httpErr.statusText).toBe('Bad Request');
    expect(httpErr.responseBody).toEqual(errorBody);
    expect(httpErr.url).toBe('https://api.example.com/submit');
    expect(httpErr.method).toBe('POST');
  });

  it('handles timeout correctly using AbortSignal', async () => {
    vi.useRealTimers();
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('Request aborted due to timeout'));
        });
      });
    }) as any;

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      defaultTimeoutMs: 50,
    });

    await expect(client.get('/hang')).rejects.toThrow();
  });

  it('aborts request when external signal is aborted', async () => {
    vi.useRealTimers();
    const controller = new AbortController();

    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('Caller aborted'));
        });
      });
    }) as any;

    const client = createHttpClient({ baseUrl: 'https://api.example.com' });
    const promise = client.get('/long', { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow('Caller aborted');
  });

  it('retries only safe/idempotent methods with bounded backoff', async () => {
    // 503 Service Unavailable followed by 200 OK
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'Unavailable',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ retried: true }),
      } as unknown as Response);

    global.fetch = fetchMock as any;

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      retryConfig: { maxRetries: 2, baseDelayMs: 50 },
    });

    const promise = client.get<{ retried: boolean }>('/safe');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ retried: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry unsafe methods (like POST) by default on 5xx errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'Server error',
    } as unknown as Response);

    global.fetch = fetchMock as any;

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      retryConfig: { maxRetries: 3, baseDelayMs: 50 },
    });

    await expect(client.post('/unsafe', { action: 'charge' })).rejects.toBeInstanceOf(HttpError);
    // Should NOT retry POST requests by default!
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('injects Bearer auth header', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
    } as unknown as Response);

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      auth: { type: 'bearer', token: 'secret-token-123' },
    });

    await client.get('/secure');
    const [, init] = (global.fetch as any).mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer secret-token-123');
  });

  it('injects Basic auth header', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
    } as unknown as Response);

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      auth: { type: 'basic', username: 'admin', password: 'password123' },
    });

    await client.get('/basic-secure');
    const [, init] = (global.fetch as any).mock.calls[0];
    expect(init.headers['Authorization']).toBe(
      `Basic ${Buffer.from('admin:password123').toString('base64')}`,
    );
  });

  it('injects custom auth header', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
    } as unknown as Response);

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      auth: { type: 'custom', headerName: 'X-API-KEY', headerValue: 'custom-api-key-999' },
    });

    await client.get('/custom-auth');
    const [, init] = (global.fetch as any).mock.calls[0];
    expect(init.headers['X-API-KEY']).toBe('custom-api-key-999');
  });
});
