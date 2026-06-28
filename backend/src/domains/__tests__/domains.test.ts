import { describe, it, expect, vi } from 'vitest';
import { createEvent, eventCatalog, EventTypes } from '../event-catalog.js';
import { DomainEventBus } from '../event-bus.js';
import type Redis from 'ioredis';

// ── Event catalog ─────────────────────────────────────────────────────────────

describe('eventCatalog', () => {
  it('contains all 6 expected event types', () => {
    const types = eventCatalog.map((e) => e.type);
    expect(types).toContain(EventTypes.PAYMENT_COMPLETED);
    expect(types).toContain(EventTypes.PAYMENT_FAILED);
    expect(types).toContain(EventTypes.MERCHANT_ONBOARDED);
    expect(types).toContain(EventTypes.WALLET_FUNDED);
    expect(types).toContain(EventTypes.NOTIFICATION_SENT);
    expect(types).toContain(EventTypes.IDENTITY_VERIFIED);
  });

  it('every catalog entry has a positive version', () => {
    for (const entry of eventCatalog) {
      expect(entry.version).toBeGreaterThan(0);
    }
  });
});

describe('createEvent', () => {
  it('creates a well-formed domain event', () => {
    const evt = createEvent(EventTypes.PAYMENT_COMPLETED, 'payments', { paymentId: 'p1', amount: 100, currency: 'XLM', from: 'A', to: 'B' });
    expect(evt.id).toMatch(/^evt_/);
    expect(evt.type).toBe(EventTypes.PAYMENT_COMPLETED);
    expect(evt.domain).toBe('payments');
    expect(evt.payload).toMatchObject({ paymentId: 'p1' });
    expect(evt.version).toBe(1);
    expect(new Date(evt.occurredAt).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

// ── DomainEventBus ────────────────────────────────────────────────────────────

function makeRedisMock() {
  let messageListener: ((_ch: string, msg: string) => void) | undefined;
  return {
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, cb: (_ch: string, msg: string) => void) => {
      if (event === 'message') messageListener = cb;
    }),
    _emit: (msg: string) => messageListener?.('domain-events', msg),
  };
}

describe('DomainEventBus', () => {
  it('publishes events to Redis', async () => {
    const pub = makeRedisMock();
    const bus = new DomainEventBus(pub as unknown as Redis);
    const evt = createEvent(EventTypes.WALLET_FUNDED, 'wallets', { walletId: 'w1', amount: 50, asset: 'XLM' });
    await bus.publish(evt);
    expect(pub.publish).toHaveBeenCalledOnce();
  });

  it('dispatches incoming events to registered handlers', async () => {
    const pub = makeRedisMock();
    const sub = makeRedisMock();
    const bus = new DomainEventBus(pub as unknown as Redis);
    await bus.subscribe(sub as unknown as Redis);

    const handler = vi.fn().mockResolvedValue(undefined);
    bus.on(EventTypes.WALLET_FUNDED, handler);

    const evt = createEvent(EventTypes.WALLET_FUNDED, 'wallets', { walletId: 'w1', amount: 50, asset: 'XLM' });
    sub._emit(JSON.stringify(evt));

    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 0));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not dispatch events to handlers for other types', async () => {
    const pub = makeRedisMock();
    const sub = makeRedisMock();
    const bus = new DomainEventBus(pub as unknown as Redis);
    await bus.subscribe(sub as unknown as Redis);

    const handler = vi.fn();
    bus.on(EventTypes.PAYMENT_COMPLETED, handler);

    const evt = createEvent(EventTypes.WALLET_FUNDED, 'wallets', { walletId: 'w2', amount: 10, asset: 'XLM' });
    sub._emit(JSON.stringify(evt));

    await new Promise((r) => setTimeout(r, 0));
    expect(handler).not.toHaveBeenCalled();
  });
});
