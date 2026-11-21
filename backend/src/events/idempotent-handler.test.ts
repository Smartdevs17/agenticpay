import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  idempotentHandler,
  createProcessedStore,
} from './idempotent-handler';
import type { StoredEvent, EventHandler } from './event-types';

describe('IdempotentHandler', () => {
  const createTestEvent = (id = 'evt-1'): StoredEvent => ({
    id,
    type: 'payment.created',
    aggregateId: 'pay-1',
    aggregateType: 'payment',
    version: 1,
    payload: { from: 'A', to: 'B', amount: 100, asset: 'USDC' },
    metadata: {},
    occurredAt: new Date().toISOString(),
    sequenceNumber: 1,
    streamId: 'payment:pay-1',
  });

  describe('idempotentHandler', () => {
    it('calls handler for first event', async () => {
      const handler = vi.fn();
      const wrapped = idempotentHandler(handler);
      const event = createTestEvent();

      await wrapped(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('skips duplicate event by id', async () => {
      const handler = vi.fn();
      const wrapped = idempotentHandler(handler);
      const event = createTestEvent();

      await wrapped(event);
      await wrapped(event);
      await wrapped(event);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('processes different event ids', async () => {
      const handler = vi.fn();
      const wrapped = idempotentHandler(handler);
      const event1 = createTestEvent('evt-1');
      const event2 = createTestEvent('evt-2');

      await wrapped(event1);
      await wrapped(event2);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('preserves handler name', () => {
      const handler = function myHandler() {};
      const wrapped = idempotentHandler(handler);

      expect(wrapped.name).toBe('idempotent(myHandler)');
    });

    it('handles anonymous handler', () => {
      const handler = (() => {
        const fn = () => {};
        Object.defineProperty(fn, 'name', { value: '' });
        return fn;
      })();
      const wrapped = idempotentHandler(handler);

      expect(wrapped.name).toBe('idempotent(anonymous)');
    });

    it('shares processed store when provided', async () => {
      const sharedStore = createProcessedStore();
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const wrapped1 = idempotentHandler(handler1, sharedStore);
      const wrapped2 = idempotentHandler(handler2, sharedStore);
      const event = createTestEvent();

      await wrapped1(event);
      await wrapped2(event);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
    });

    it('propagates errors from handler', async () => {
      const error = new Error('Handler failed');
      const handler = vi.fn().mockRejectedValue(error);
      const wrapped = idempotentHandler(handler);
      const event = createTestEvent();

      await expect(wrapped(event)).rejects.toThrow('Handler failed');
    });

    it('marks event as processed even if handler throws', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));
      const wrapped = idempotentHandler(handler);
      const event = createTestEvent();

      await expect(wrapped(event)).rejects.toThrow();

      await expect(wrapped(event)).resolves.not.toThrow();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('createProcessedStore', () => {
    it('creates a new Set', () => {
      const store = createProcessedStore();
      expect(store).toBeInstanceOf(Set);
    });
  });
});