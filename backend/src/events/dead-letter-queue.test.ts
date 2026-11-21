import { beforeEach, describe, expect, it } from 'vitest';
import {
  addToDeadLetterQueue,
  getDeadLetterQueue,
  getAllDeadLetterEntries,
  resolveDeadLetterEntry,
  getDeadLetterStats,
  purgeResolvedEntries,
  clearDeadLetterQueue,
} from './dead-letter-queue';
import type { StoredEvent } from './event-types';

describe('DeadLetterQueue', () => {
  beforeEach(() => {
    clearDeadLetterQueue();
  });

  const createTestEvent = (overrides: Partial<StoredEvent> = {}): StoredEvent => ({
    id: 'evt-1',
    type: 'payment.created',
    aggregateId: 'pay-1',
    aggregateType: 'payment',
    version: 1,
    payload: { from: 'A', to: 'B', amount: 100, asset: 'USDC' },
    metadata: {},
    occurredAt: new Date().toISOString(),
    sequenceNumber: 1,
    streamId: 'payment:pay-1',
    ...overrides,
  });

  describe('addToDeadLetterQueue', () => {
    it('adds entry to queue with correct properties', () => {
      const event = createTestEvent();
      const error = new Error('Handler failed');

      const entry = addToDeadLetterQueue(event, 'testHandler', error);

      expect(entry.id).toMatch(/^dlq-\d+$/);
      expect(entry.event).toBe(event);
      expect(entry.handlerName).toBe('testHandler');
      expect(entry.error).toBe('Handler failed');
      expect(entry.failedAt).toBeDefined();
      expect(entry.retryCount).toBe(0);
      expect(entry.lastRetryAt).toBeNull();
      expect(entry.resolvedAt).toBeNull();
    });

    it('increments id for each entry', () => {
      const event = createTestEvent();
      const error = new Error('Handler failed');

      const entry1 = addToDeadLetterQueue(event, 'handler1', error);
      const entry2 = addToDeadLetterQueue(event, 'handler2', error);

      expect(parseInt(entry1.id.split('-')[1])).toBeLessThan(parseInt(entry2.id.split('-')[1]));
    });

    it('handles non-Error errors', () => {
      const event = createTestEvent();

      const entry = addToDeadLetterQueue(event, 'testHandler', 'string error');

      expect(entry.error).toBe('string error');
    });

    it('handles undefined error', () => {
      const event = createTestEvent();
      const entry = addToDeadLetterQueue(event, 'testHandler', undefined);
      expect(entry.error).toBe('undefined');
    });

    it('tracks retry count', () => {
      const event = createTestEvent();
      const error = new Error('Handler failed');

      const entry = addToDeadLetterQueue(event, 'testHandler', error, 3);

      expect(entry.retryCount).toBe(3);
      expect(entry.lastRetryAt).toBeDefined();
    });
  });

  describe('getDeadLetterQueue', () => {
    it('returns only unresolved entries', () => {
      const event = createTestEvent();
      const error = new Error('Handler failed');

      addToDeadLetterQueue(event, 'handler1', error);
      const entry2 = addToDeadLetterQueue(event, 'handler2', error);
      resolveDeadLetterEntry(entry2.id);

      const queue = getDeadLetterQueue();

      expect(queue.length).toBe(1);
      expect(queue[0].handlerName).toBe('handler1');
    });

    it('returns empty when all resolved', () => {
      const event = createTestEvent();
      const entry = addToDeadLetterQueue(event, 'handler1', new Error('fail'));
      resolveDeadLetterEntry(entry.id);
      expect(getDeadLetterQueue().length).toBe(0);
    });
  });

  describe('getAllDeadLetterEntries', () => {
    it('returns all entries including resolved', () => {
      const event = createTestEvent();
      const error = new Error('Handler failed');

      addToDeadLetterQueue(event, 'handler1', error);
      const entry2 = addToDeadLetterQueue(event, 'handler2', error);
      resolveDeadLetterEntry(entry2.id);

      const allEntries = getAllDeadLetterEntries();

      expect(allEntries.length).toBe(2);
    });
  });

  describe('resolveDeadLetterEntry', () => {
    it('marks entry as resolved', () => {
      const event = createTestEvent();
      const error = new Error('Handler failed');

      const entry = addToDeadLetterQueue(event, 'handler1', error);
      const resolved = resolveDeadLetterEntry(entry.id);

      expect(resolved).toBe(true);
      expect(getDeadLetterQueue().length).toBe(0);
      expect(getAllDeadLetterEntries()[0].resolvedAt).toBeDefined();
    });

    it('returns false for non-existent entry', () => {
      const resolved = resolveDeadLetterEntry('non-existent');
      expect(resolved).toBe(false);
    });

    it('returns false for already resolved entry', () => {
      const event = createTestEvent();
      const error = new Error('Handler failed');

      const entry = addToDeadLetterQueue(event, 'handler1', error);
      resolveDeadLetterEntry(entry.id);
      const resolved = resolveDeadLetterEntry(entry.id);

      expect(resolved).toBe(false);
    });
  });

  describe('getDeadLetterStats', () => {
    it('returns correct stats', () => {
      const event = createTestEvent();
      const error = new Error('Handler failed');

      addToDeadLetterQueue(event, 'handler1', error);
      addToDeadLetterQueue(event, 'handler1', error);
      addToDeadLetterQueue(event, 'handler2', error);

      const stats = getDeadLetterStats();

      expect(stats.total).toBe(3);
      expect(stats.unresolved).toBe(3);
      expect(stats.byHandler['handler1']).toBe(2);
      expect(stats.byHandler['handler2']).toBe(1);
    });

    it('excludes resolved from unresolved count', () => {
      const event = createTestEvent();
      const e1 = addToDeadLetterQueue(event, 'handler1', new Error('fail'));
      addToDeadLetterQueue(event, 'handler1', new Error('fail'));
      resolveDeadLetterEntry(e1.id);
      const stats = getDeadLetterStats();
      expect(stats.total).toBe(2);
      expect(stats.unresolved).toBe(1);
    });
  });

  describe('purgeResolvedEntries', () => {
    it('removes resolved entries older than maxAgeMs', async () => {
      const event = createTestEvent();
      const error = new Error('Handler failed');

      const entry = addToDeadLetterQueue(event, 'handler1', error);
      resolveDeadLetterEntry(entry.id);
      // Make resolvedAt old
      const all = getAllDeadLetterEntries();
      all[0].resolvedAt = new Date(Date.now() - 10000).toISOString();

      const purged = purgeResolvedEntries(5000);

      expect(purged).toBe(1);
      expect(getAllDeadLetterEntries().length).toBe(0);
    });

    it('keeps resolved entries newer than maxAgeMs', () => {
      const event = createTestEvent();
      const error = new Error('Handler failed');

      const entry = addToDeadLetterQueue(event, 'handler1', error);
      resolveDeadLetterEntry(entry.id);

      const purged = purgeResolvedEntries(5000);

      expect(purged).toBe(0);
      expect(getAllDeadLetterEntries().length).toBe(1);
    });

    it('keeps unresolved entries', () => {
      const event = createTestEvent();
      const error = new Error('Handler failed');

      addToDeadLetterQueue(event, 'handler1', error);

      const purged = purgeResolvedEntries(5000);

      expect(purged).toBe(0);
      expect(getAllDeadLetterEntries().length).toBe(1);
    });
  });

  describe('clearDeadLetterQueue', () => {
    it('clears queue and resets id', () => {
      const event = createTestEvent();
      addToDeadLetterQueue(event, 'h', new Error('e'));
      clearDeadLetterQueue();
      expect(getAllDeadLetterEntries().length).toBe(0);
      const e2 = addToDeadLetterQueue(event, 'h', new Error('e'));
      expect(e2.id).toBe('dlq-1');
    });
  });
});
