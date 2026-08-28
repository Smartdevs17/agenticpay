import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  loadStream,
  loadEvents,
  loadSnapshot,
  getAllEvents,
  getEventsByType,
  getAllStreams,
  getEventStats,
  clearEventStore,
} from './event-store';

describe('InMemoryEventStore', () => {
  beforeEach(() => {
    clearEventStore();
  });

  describe('appendEvent', () => {
    it('appends first event to new stream', () => {
      const event = appendEvent('payment', 'pay-1', 'payment.created', {
        from: 'A',
        to: 'B',
        amount: 100,
        asset: 'USDC',
      } as any);

      expect(event.aggregateId).toBe('pay-1');
      expect(event.aggregateType).toBe('payment');
      expect(event.type).toBe('payment.created');
      expect(event.version).toBe(1);
      expect(event.sequenceNumber).toBe(1);
      expect(event.payload).toEqual({ from: 'A', to: 'B', amount: 100, asset: 'USDC' });
      expect(event.id).toBeDefined();
      expect(event.occurredAt).toBeDefined();
      expect(event.streamId).toBe('payment:pay-1');
    });

    it('increments version for subsequent events', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      const event2 = appendEvent('payment', 'pay-1', 'payment.executed', {
        paymentId: 'pay-1',
        transactionHash: 'hash-1',
        amount: 100,
        asset: 'USDC',
      } as any);

      expect(event2.version).toBe(2);
      expect(event2.sequenceNumber).toBe(2);
    });

    it('respects expectedVersion for optimistic concurrency', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);

      expect(() =>
        appendEvent('payment', 'pay-1', 'payment.executed', { paymentId: 'pay-1' } as any, {}, { expectedVersion: 2 })
      ).toThrow('Optimistic concurrency conflict');
    });

    it('succeeds when expectedVersion matches', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      expect(() =>
        appendEvent('payment', 'pay-1', 'payment.executed', { paymentId: 'pay-1' } as any, {}, { expectedVersion: 1 })
      ).not.toThrow();
    });

    it('includes metadata in event', () => {
      const metadata = {
        correlationId: 'corr-1',
        causationId: 'caus-1',
        userId: 'user-1',
      };

      const event = appendEvent(
        'payment',
        'pay-1',
        'payment.created',
        { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any,
        metadata
      );

      expect(event.metadata).toEqual(metadata);
    });

    it('maintains separate streams for different aggregates', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      appendEvent('project', 'proj-1', 'project.created', { client: 'C', amount: 500 } as any);

      const paymentStream = loadStream('payment', 'pay-1');
      const projectStream = loadStream('project', 'proj-1');

      expect(paymentStream?.events.length).toBe(1);
      expect(projectStream?.events.length).toBe(1);
      expect(paymentStream?.aggregateType).toBe('payment');
      expect(projectStream?.aggregateType).toBe('project');
    });

    it('maintains separate streams for same type different id', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      appendEvent('payment', 'pay-2', 'payment.created', { from: 'C', to: 'D', amount: 200, asset: 'USDC' } as any);
      expect(getAllStreams().length).toBe(2);
    });
  });

  describe('loadStream', () => {
    it('returns stream with all events in order', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      appendEvent('payment', 'pay-1', 'payment.executed', {
        paymentId: 'pay-1',
        transactionHash: 'hash-1',
        amount: 100,
        asset: 'USDC',
      } as any);

      const stream = loadStream('payment', 'pay-1');

      expect(stream).toBeDefined();
      expect(stream?.events.length).toBe(2);
      expect(stream?.version).toBe(2);
      expect(stream?.events[0].type).toBe('payment.created');
      expect(stream?.events[1].type).toBe('payment.executed');
      expect(stream?.streamId).toBe('payment:pay-1');
    });

    it('returns undefined for non-existent stream', () => {
      const stream = loadStream('payment', 'non-existent');
      expect(stream).toBeUndefined();
    });
  });

  describe('loadEvents', () => {
    it('returns events after specified version', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      appendEvent('payment', 'pay-1', 'payment.executed', {
        paymentId: 'pay-1',
        transactionHash: 'hash-1',
        amount: 100,
        asset: 'USDC',
      } as any);
      appendEvent('payment', 'pay-1', 'receipt.minted', { tokenId: 'token-1', paymentId: 'pay-1' } as any);

      const events = loadEvents('payment', 'pay-1', 1);

      expect(events.length).toBe(2);
      expect(events[0].version).toBe(2);
      expect(events[1].version).toBe(3);
    });

    it('returns all events when fromVersion is 0', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      appendEvent('payment', 'pay-1', 'payment.executed', {
        paymentId: 'pay-1',
        transactionHash: 'hash-1',
        amount: 100,
        asset: 'USDC',
      } as any);

      const events = loadEvents('payment', 'pay-1', 0);

      expect(events.length).toBe(2);
    });

    it('returns empty array for non-existent stream', () => {
      const events = loadEvents('payment', 'non-existent', 0);
      expect(events).toEqual([]);
    });
  });

  describe('loadSnapshot', () => {
    it('returns events up to specified timestamp', async () => {
      const before = new Date(Date.now() - 10000).toISOString();
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      const future = new Date(Date.now() + 10000).toISOString();

      const pastEvents = loadSnapshot({ aggregateType: 'payment', aggregateId: 'pay-1', asOf: before });
      expect(pastEvents.length).toBe(0);

      const futureEvents = loadSnapshot({ aggregateType: 'payment', aggregateId: 'pay-1', asOf: future });
      expect(futureEvents.length).toBe(1);
    });

    it('returns empty for non-existent stream', () => {
      const events = loadSnapshot({ aggregateType: 'payment', aggregateId: 'nope', asOf: new Date().toISOString() });
      expect(events).toEqual([]);
    });
  });

  describe('getAllEvents', () => {
    it('returns all events globally', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      appendEvent('project', 'proj-1', 'project.created', { client: 'C', amount: 500 } as any);

      const events = getAllEvents();

      expect(events.length).toBe(2);
    });

    it('filters by sequence number', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      appendEvent('project', 'proj-1', 'project.created', { client: 'C', amount: 500 } as any);

      const events = getAllEvents(1);

      expect(events.length).toBe(1);
      expect(events[0].sequenceNumber).toBe(2);
    });
  });

  describe('getEventsByType', () => {
    it('filters events by type', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      appendEvent('payment', 'pay-1', 'payment.executed', {
        paymentId: 'pay-1',
        transactionHash: 'hash-1',
        amount: 100,
        asset: 'USDC',
      } as any);
      appendEvent('project', 'proj-1', 'project.created', { client: 'C', amount: 500 } as any);

      const events = getEventsByType('payment.created');

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('payment.created');
    });

    it('returns empty when no match', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      expect(getEventsByType('payment.failed')).toEqual([]);
    });
  });

  describe('getAllStreams', () => {
    it('returns all streams', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      appendEvent('project', 'proj-1', 'project.created', { client: 'C', amount: 500 } as any);

      const streams = getAllStreams();

      expect(streams.length).toBe(2);
    });
  });

  describe('getEventStats', () => {
    it('returns correct statistics', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      appendEvent('payment', 'pay-1', 'payment.executed', {
        paymentId: 'pay-1',
        transactionHash: 'hash-1',
        amount: 100,
        asset: 'USDC',
      } as any);
      appendEvent('project', 'proj-1', 'project.created', { client: 'C', amount: 500 } as any);

      const stats = getEventStats();

      expect(stats.totalEvents).toBe(3);
      expect(stats.totalStreams).toBe(2);
      expect(stats.typeCounts['payment.created']).toBe(1);
      expect(stats.typeCounts['payment.executed']).toBe(1);
      expect(stats.typeCounts['project.created']).toBe(1);
    });

    it('returns zero stats when empty', () => {
      const stats = getEventStats();
      expect(stats.totalEvents).toBe(0);
      expect(stats.totalStreams).toBe(0);
    });
  });

  describe('clearEventStore', () => {
    it('clears all streams and sequences', () => {
      appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      clearEventStore();
      expect(getAllEvents().length).toBe(0);
      expect(getAllStreams().length).toBe(0);
      expect(getEventStats().totalEvents).toBe(0);
    });
  });
});
