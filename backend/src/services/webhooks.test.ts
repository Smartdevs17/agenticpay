import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  upsertWebhookConfig,
  enqueueWebhookEvent,
  startWebhookWorker,
  stopWebhookWorker,
  getWebhookDelivery,
  drainWebhookDeliveries,
  getActiveWebhookShards,
  getWebhookDispatchStats,
} from './webhooks.js';

describe('webhook worker', () => {
  afterEach(() => {
    stopWebhookWorker();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('never runs two overlapping passes while a delivery is still in flight', async () => {
    vi.useFakeTimers();

    let resolveFetch: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve({ ok: true, status: 200, text: async () => '{}' } as Response);
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const config = upsertWebhookConfig({
      merchantId: 'merchant_1',
      url: 'https://merchant.example/webhook',
      secret: 'a_very_secret_value',
    });
    const { delivery } = enqueueWebhookEvent({
      merchantId: config.merchantId,
      type: 'payment.completed',
      payload: { amount: 100 },
    });
    expect(delivery).toBeDefined();

    startWebhookWorker();

    // First tick: picks up the delivery and starts the (slow, unresolved) fetch.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Several more ticks elapse while the first attempt is still in flight.
    // Without the in-flight guard, each tick would start another pass and
    // call fetch again for the same still-"processing" delivery.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(getWebhookDelivery(delivery!.id)?.status).toBe('delivered');
  });
});

describe('domain-sharded webhook dispatch (#1462)', () => {
  afterEach(() => {
    stopWebhookWorker();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** fetch stub: URLs containing `hang` stay pending until released; others answer 200. */
  function stubFetch() {
    const calls: string[] = [];
    const releases: Array<() => void> = [];
    const fetchMock = vi.fn((url: string) => {
      calls.push(url);
      if (url.includes('hang')) {
        return new Promise((resolve) => {
          releases.push(() => resolve({ ok: true, status: 200, text: async () => '{}' } as Response));
        });
      }
      return Promise.resolve({ ok: true, status: 200, text: async () => '{}' } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, calls, releaseAll: () => releases.splice(0).forEach((r) => r()) };
  }

  function merchant(id: string, url: string) {
    upsertWebhookConfig({ merchantId: id, url, secret: 'a_very_secret_value' });
    return (type = 'payment.completed') =>
      enqueueWebhookEvent({ merchantId: id, type, payload: { id } }).delivery!;
  }

  it('delivers to healthy hosts while another host hangs', async () => {
    vi.useFakeTimers();
    const { calls, releaseAll } = stubFetch();
    const slow = merchant('m_hang', 'https://hang.slow-merchant.example/hook');
    const fast = merchant('m_fast', 'https://fast-merchant.example/hook');

    const slowDelivery = slow();
    const fastDeliveries = [fast(), fast(), fast()];

    startWebhookWorker();
    await vi.advanceTimersByTimeAsync(1_000);

    // The hanging host holds only its own lane; the healthy host drains fully.
    for (const d of fastDeliveries) expect(getWebhookDelivery(d.id)?.status).toBe('delivered');
    expect(getWebhookDelivery(slowDelivery.id)?.status).toBe('processing');
    expect(getActiveWebhookShards()).toEqual(['hang.slow-merchant.example']);

    // A delivery enqueued for the healthy host later is not stuck behind the hang either.
    const late = fast('payment.refunded');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getWebhookDelivery(late.id)?.status).toBe('delivered');

    // The hanging host was sent exactly one request across all those ticks.
    expect(calls.filter((url) => url.includes('hang'))).toHaveLength(1);

    releaseAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(getWebhookDelivery(slowDelivery.id)?.status).toBe('delivered');
    expect(getActiveWebhookShards()).toEqual([]);
  });

  it('sends one request at a time to the same host, in order', async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(JSON.parse(String(init.body)).type);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { ok: true, status: 200, text: async () => '{}' } as Response;
      }),
    );
    const send = merchant('m_serial', 'https://serial-merchant.example/hook');
    const deliveries = ['a', 'b', 'c'].map((t) => send(`evt.${t}`));

    await drainWebhookDeliveries();

    expect(maxInFlight).toBe(1);
    expect(order).toEqual(['evt.a', 'evt.b', 'evt.c']);
    for (const d of deliveries) expect(getWebhookDelivery(d.id)?.status).toBe('delivered');
  });

  it('still retries failures on their own host without blocking others', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('broken')
          ? ({ ok: false, status: 503, text: async () => 'down' } as Response)
          : ({ ok: true, status: 200, text: async () => '{}' } as Response),
      ),
    );
    const broken = merchant('m_broken', 'https://broken-merchant.example/hook')();
    const healthy = merchant('m_healthy', 'https://healthy-merchant.example/hook')();

    await drainWebhookDeliveries();

    expect(getWebhookDelivery(healthy.id)?.status).toBe('delivered');
    const failed = getWebhookDelivery(broken.id)!;
    expect(failed.status).toBe('retrying');
    expect(failed.attempt).toBe(1);
    expect(failed.lastError).toBe('HTTP 503');
  });

  it('exposes dispatch stats with queue-wait percentiles and the active config', async () => {
    stubFetch();
    merchant('m_stats', 'https://stats-merchant.example/hook')();

    await drainWebhookDeliveries();

    const stats = getWebhookDispatchStats();
    expect(stats.config).toEqual({ maxConcurrentShards: 8, maxBatchPerShard: 25 });
    expect(stats.passes).toBeGreaterThan(0);
    expect(stats.deliveriesStarted).toBeGreaterThan(0);
    expect(stats.queueWaitMs.samples).toBeGreaterThan(0);
    expect(stats.activeShards).toBe(0);
  });
});
