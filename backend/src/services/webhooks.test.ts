import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  upsertWebhookConfig,
  enqueueWebhookEvent,
  startWebhookWorker,
  stopWebhookWorker,
  getWebhookDelivery,
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
