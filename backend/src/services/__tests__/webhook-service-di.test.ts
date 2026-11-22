import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WebhookRetryService,
  InMemoryWebhookStore,
  type IWebhookTransport,
  type IClock,
  type IWebhookLogger,
  type IWebhookTransportResponse,
  type WebhookDeliveryLog,
} from '../webhooks.js';

class FakeClock implements IClock {
  private currentTime = 1700000000000;
  private timerId = 1;

  now(): number {
    return this.currentTime;
  }

  nowIso(): string {
    return new Date(this.currentTime).toISOString();
  }

  advance(ms: number) {
    this.currentTime += ms;
  }

  setTimeout(cb: () => void, ms: number): NodeJS.Timeout {
    return setTimeout(cb, ms);
  }

  clearTimeout(t: NodeJS.Timeout): void {
    clearTimeout(t);
  }

  setInterval(cb: () => void, ms: number): NodeJS.Timeout {
    return setInterval(cb, ms);
  }

  clearInterval(t: NodeJS.Timeout): void {
    clearInterval(t);
  }
}

class FakeTransport implements IWebhookTransport {
  public calls: Array<{ url: string; options: any }> = [];
  public handler?: (url: string, options: any) => Promise<IWebhookTransportResponse>;

  async send(url: string, options: any): Promise<IWebhookTransportResponse> {
    this.calls.push({ url, options });
    if (this.handler) {
      return this.handler(url, options);
    }
    return {
      ok: true,
      status: 200,
      text: async () => '{"received":true}',
    };
  }
}

class FakeLogger implements IWebhookLogger {
  public logs: Array<{ level: string; msg: string; meta?: any }> = [];
  info(msg: string, meta?: any) {
    this.logs.push({ level: 'info', msg, meta });
  }
  warn(msg: string, meta?: any) {
    this.logs.push({ level: 'warn', msg, meta });
  }
  error(msg: string, meta?: any) {
    this.logs.push({ level: 'error', msg, meta });
  }
}

describe('WebhookRetryService with Dependency Injection (Issue #1410)', () => {
  let store: InMemoryWebhookStore;
  let transport: FakeTransport;
  let clock: FakeClock;
  let logger: FakeLogger;
  let service: WebhookRetryService;

  beforeEach(() => {
    store = new InMemoryWebhookStore();
    transport = new FakeTransport();
    clock = new FakeClock();
    logger = new FakeLogger();
    service = new WebhookRetryService({
      store,
      transport,
      clock,
      logger,
      jitterFn: () => 0, // deterministic backoff for tests
      dispatcherOptions: { maxConcurrentShards: 4, maxBatchPerShard: 10 },
    });
  });

  it('delivers successfully on the first try', async () => {
    const config = service.upsertConfig({
      merchantId: 'm_1',
      url: 'https://merchant.example/webhook',
      secret: 'whsec_test123',
    });

    const { delivery } = service.enqueueEvent({
      merchantId: config.merchantId,
      type: 'payment.completed',
      payload: { amount: 100 },
    });
    expect(delivery).toBeDefined();

    await service.drainDeliveries();

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].url).toBe('https://merchant.example/webhook');
    expect(transport.calls[0].options.headers['X-Webhook-Idempotency-Key']).toBe(delivery!.idempotencyKey);
    const updated = service.getDelivery(delivery!.id);
    expect(updated?.status).toBe('delivered');
    expect(updated?.attempt).toBe(1);
    expect(updated?.statusCode).toBe(200);
  });

  it('retries with backoff on error then succeeds', async () => {
    let attemptCount = 0;
    transport.handler = async () => {
      attemptCount++;
      if (attemptCount === 1) {
        return {
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable',
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => 'OK',
      };
    };

    const config = service.upsertConfig({
      merchantId: 'm_retry',
      url: 'https://merchant.example/webhook',
      secret: 'whsec_retry',
    });

    const { delivery } = service.enqueueEvent({
      merchantId: config.merchantId,
      type: 'order.created',
      payload: { id: 1 },
    });

    // First attempt fails
    await service.drainDeliveries();
    let record = service.getDelivery(delivery!.id)!;
    expect(record.status).toBe('retrying');
    expect(record.attempt).toBe(1);
    expect(record.lastError).toBe('HTTP 503');

    // Advance clock past the backoff interval (1000ms for attempt 1)
    clock.advance(1500);

    // Second attempt succeeds
    await service.drainDeliveries();
    record = service.getDelivery(delivery!.id)!;
    expect(record.status).toBe('delivered');
    expect(record.attempt).toBe(2);
    expect(record.statusCode).toBe(200);
  });

  it('moves exhausted retries to dead_letter queue after maxAttempts', async () => {
    transport.handler = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const config = service.upsertConfig({
      merchantId: 'm_exhaust',
      url: 'https://merchant.example/webhook',
      secret: 'whsec_exhaust',
    });

    const { delivery } = service.enqueueEvent({
      merchantId: config.merchantId,
      type: 'order.failed',
      payload: { id: 2 },
    });

    // Perform 5 attempts (advancing clock between attempts)
    for (let i = 0; i < 5; i++) {
      await service.drainDeliveries();
      clock.advance(65000); // advance past max backoff
    }

    const record = service.getDelivery(delivery!.id)!;
    expect(record.status).toBe('dead_letter');
    expect(record.attempt).toBe(5);
    expect(service.listDeadLetter()).toHaveLength(1);
  });

  it('handles transport timeouts cleanly', async () => {
    transport.handler = async () => {
      throw new Error('Connection timed out');
    };

    const config = service.upsertConfig({
      merchantId: 'm_timeout',
      url: 'https://merchant.example/webhook',
      secret: 'whsec_timeout',
    });

    const { delivery } = service.enqueueEvent({
      merchantId: config.merchantId,
      type: 'payment.timeout',
      payload: {},
    });

    await service.drainDeliveries();

    const record = service.getDelivery(delivery!.id)!;
    expect(record.status).toBe('retrying');
    expect(record.lastError).toBe('Connection timed out');
  });

  it('recovers from store crash / restart with pending deliveries intact', async () => {
    const config = service.upsertConfig({
      merchantId: 'm_crash',
      url: 'https://merchant.example/webhook',
      secret: 'whsec_crash',
    });

    const { delivery } = service.enqueueEvent({
      merchantId: config.merchantId,
      type: 'payment.restarted',
      payload: { state: 'persisted' },
    });

    // Simulate service restart: create a new service instance pointing to the existing store
    const restartedService = new WebhookRetryService({
      store,
      transport,
      clock,
      logger,
      jitterFn: () => 0,
    });

    // Verify pending delivery was recovered from store
    const recovered = restartedService.getDelivery(delivery!.id);
    expect(recovered?.status).toBe('pending');
    expect(recovered?.attempt).toBe(0);

    // Drain with the new service instance
    await restartedService.drainDeliveries();
    expect(restartedService.getDelivery(delivery!.id)?.status).toBe('delivered');
  });

  it('enforces idempotency on duplicate events', () => {
    const config = service.upsertConfig({
      merchantId: 'm_idemp',
      url: 'https://merchant.example/webhook',
      secret: 'whsec_idemp',
    });

    const first = service.enqueueEvent({
      merchantId: config.merchantId,
      type: 'charge.succeeded',
      payload: { id: 100 },
      idempotencyKey: 'idemp_unique_key_1',
    });
    expect(first.accepted).toBe(true);

    const duplicate = service.enqueueEvent({
      merchantId: config.merchantId,
      type: 'charge.succeeded',
      payload: { id: 100 },
      idempotencyKey: 'idemp_unique_key_1',
    });
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.reason).toBe('Duplicate idempotency key');
    expect(duplicate.delivery?.id).toBe(first.delivery?.id);
  });

  it('bounds concurrent shard delivery lanes', async () => {
    let activeLanes = 0;
    let maxObservedLanes = 0;

    transport.handler = async () => {
      activeLanes++;
      maxObservedLanes = Math.max(maxObservedLanes, activeLanes);
      await new Promise((r) => setTimeout(r, 10));
      activeLanes--;
      return { ok: true, status: 200, text: async () => 'OK' };
    };

    // 10 merchants on different hosts
    for (let i = 0; i < 10; i++) {
      const cfg = service.upsertConfig({
        merchantId: `m_host_${i}`,
        url: `https://host${i}.example/webhook`,
        secret: 'whsec_multi',
      });
      service.enqueueEvent({ merchantId: cfg.merchantId, type: 'ping', payload: {} });
    }

    await service.drainDeliveries();

    // maxConcurrentShards was configured as 4
    expect(maxObservedLanes).toBeLessThanOrEqual(4);
  });
});
