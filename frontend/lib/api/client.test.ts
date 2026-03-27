import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiCall } from './client';
import { OfflineActionQueuedError } from '@/lib/offline';

describe('apiCall', () => {
  const originalFetch = global.fetch;
  const originalNavigator = global.navigator;
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
  })();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', {
      localStorage: localStorageMock,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    Object.defineProperty(global, 'navigator', {
      value: { onLine: true },
      configurable: true,
    });
    localStorageMock.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    global.fetch = originalFetch;
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  });

  it('retries retriable HTTP failures with exponential backoff', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Temporary outage' }), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        })
      );

    global.fetch = fetchMock as typeof fetch;

    const promise = apiCall<{ ok: boolean }>('/health', {}, { baseDelay: 100, maxDelay: 1000, jitter: false });

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retriable HTTP errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Bad request' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    global.fetch = fetchMock as typeof fetch;

    await expect(apiCall('/health')).rejects.toMatchObject<ApiError>({
      name: 'ApiError',
      status: 400,
      message: 'Bad request',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry aborted requests', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const fetchMock = vi.fn().mockRejectedValue(abortError);

    global.fetch = fetchMock as typeof fetch;

    await expect(apiCall('/health')).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('queues mutating requests while offline', async () => {
    Object.defineProperty(global, 'navigator', {
      value: { onLine: false },
      configurable: true,
    });

    await expect(
      apiCall('/verification/verify', {
        method: 'POST',
        body: JSON.stringify({ ok: true }),
      })
    ).rejects.toBeInstanceOf(OfflineActionQueuedError);

    const stored = localStorageMock.getItem('agenticpay-offline-queue');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored as string)).toHaveLength(1);
  });
});
