import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventMetricsCollector,
  EventPerformanceMonitor,
} from './event-metrics';
import type { StoredEvent } from '../event-types';

describe('EventMetricsCollector', () => {
  let collector: EventMetricsCollector;

  beforeEach(() => {
    collector = new EventMetricsCollector();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  const createTestEvent = (type = 'payment.created', overrides: Partial<StoredEvent> = {}): StoredEvent => ({
    id: 'evt-1',
    type,
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

  describe('recordEventProcessed', () => {
    it('records event metrics', () => {
      const event = createTestEvent();

      collector.recordEventProcessed(event, 100, true);

      const metrics = collector.getEventMetrics('payment.created');
      expect(metrics).toBeDefined();
      expect(metrics?.count).toBe(1);
      expect(metrics?.successCount).toBe(1);
      expect(metrics?.failureCount).toBe(0);
      expect(metrics?.avgProcessingTime).toBe(100);
      expect(metrics?.minProcessingTime).toBe(100);
      expect(metrics?.maxProcessingTime).toBe(100);
    });

    it('records failure metrics', () => {
      const event = createTestEvent();

      collector.recordEventProcessed(event, 100, false);

      const metrics = collector.getEventMetrics('payment.created');
      expect(metrics?.failureCount).toBe(1);
    });

    it('calculates average processing time correctly', () => {
      const event = createTestEvent();

      collector.recordEventProcessed(event, 100, true);
      collector.recordEventProcessed(event, 200, true);
      collector.recordEventProcessed(event, 300, true);

      const metrics = collector.getEventMetrics('payment.created');
      expect(metrics?.avgProcessingTime).toBe(200);
    });

    it('tracks min and max processing time', () => {
      const event = createTestEvent();

      collector.recordEventProcessed(event, 100, true);
      collector.recordEventProcessed(event, 50, true);
      collector.recordEventProcessed(event, 200, true);

      const metrics = collector.getEventMetrics('payment.created');
      expect(metrics?.minProcessingTime).toBe(50);
      expect(metrics?.maxProcessingTime).toBe(200);
    });

    it('stores processing time samples for percentiles', () => {
      const event = createTestEvent();

      collector.recordEventProcessed(event, 100, true);
      collector.recordEventProcessed(event, 200, true);
      collector.recordEventProcessed(event, 300, true);

      expect(collector.getProcessingTimePercentile('payment.created', 50)).toBe(200);
      expect(collector.getProcessingTimePercentile('payment.created', 90)).toBe(300);
    });

    it('limits stored samples to maxSamples', () => {
      const event = createTestEvent();

      for (let i = 0; i < 1100; i++) {
        collector.recordEventProcessed(event, i, true);
      }

      const samples = collector.getProcessingTimePercentile('payment.created', 100);
      expect(samples).toBe(1099);
    });
  });

  describe('recordHandlerExecuted', () => {
    it('records handler metrics', () => {
      const event = createTestEvent();

      collector.recordHandlerExecuted('testHandler', event, 50, true);

      const metrics = collector.getHandlerMetrics('testHandler');
      expect(metrics).toBeDefined();
      expect(metrics?.totalProcessed).toBe(1);
      expect(metrics?.successCount).toBe(1);
      expect(metrics?.avgProcessingTime).toBe(50);
      expect(metrics?.eventTypes).toContain('payment.created');
    });

    it('tracks multiple event types for same handler', () => {
      const event1 = createTestEvent('payment.created');
      const event2 = createTestEvent('payment.executed');

      collector.recordHandlerExecuted('testHandler', event1, 50, true);
      collector.recordHandlerExecuted('testHandler', event2, 100, true);

      const metrics = collector.getHandlerMetrics('testHandler');
      expect(metrics?.eventTypes).toContain('payment.created');
      expect(metrics?.eventTypes).toContain('payment.executed');
    });
  });

  describe('getAllEventMetrics', () => {
    it('returns all event metrics', () => {
      collector.recordEventProcessed(createTestEvent('payment.created'), 100, true);
      collector.recordEventProcessed(createTestEvent('payment.executed'), 200, true);

      const all = collector.getAllEventMetrics();

      expect(Object.keys(all).length).toBe(2);
      expect(all['payment.created']).toBeDefined();
      expect(all['payment.executed']).toBeDefined();
    });
  });

  describe('getAllHandlerMetrics', () => {
    it('returns all handler metrics', () => {
      const event = createTestEvent();

      collector.recordHandlerExecuted('handler1', event, 50, true);
      collector.recordHandlerExecuted('handler2', event, 100, true);

      const all = collector.getAllHandlerMetrics();

      expect(Object.keys(all).length).toBe(2);
      expect(all['handler1']).toBeDefined();
      expect(all['handler2']).toBeDefined();
    });
  });

  describe('getSystemMetrics', () => {
    it('calculates system metrics', () => {
      const event = createTestEvent();

      collector.recordEventProcessed(event, 100, true);
      collector.recordEventProcessed(event, 200, false);
      collector.recordHandlerExecuted('handler1', event, 50, true);
      collector.recordHandlerExecuted('handler1', event, 100, false);

      vi.advanceTimersByTime(1000);

      const metrics = collector.getSystemMetrics();

      expect(metrics.totalEventsProcessed).toBe(2);
      expect(metrics.totalHandlersExecuted).toBe(2);
      expect(metrics.totalErrors).toBe(1);
      expect(metrics.eventsPerSecond).toBeGreaterThan(0);
      expect(metrics.uptime).toBe(1000);
      expect(metrics.memoryUsage).toBeDefined();
    });
  });

  describe('takeSnapshot', () => {
    it('returns performance snapshot', () => {
      const event = createTestEvent();

      collector.recordEventProcessed(event, 100, true);
      collector.recordHandlerExecuted('handler1', event, 50, true);

      const snapshot = collector.takeSnapshot();

      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.eventMetrics).toBeDefined();
      expect(snapshot.handlerMetrics).toBeDefined();
      expect(snapshot.systemMetrics).toBeDefined();
    });
  });

  describe('reset', () => {
    it('clears all metrics', () => {
      const event = createTestEvent();

      collector.recordEventProcessed(event, 100, true);
      collector.recordHandlerExecuted('handler1', event, 50, true);

      collector.reset();

      expect(collector.getAllEventMetrics()).toEqual({});
      expect(collector.getAllHandlerMetrics()).toEqual({});
      expect(collector.getSystemMetrics().totalEventsProcessed).toBe(0);
    });
  });

  describe('getTopSlowEvents', () => {
    it('returns slowest events', () => {
      collector.recordEventProcessed(createTestEvent('fast'), 10, true);
      collector.recordEventProcessed(createTestEvent('slow'), 1000, true);
      collector.recordEventProcessed(createTestEvent('medium'), 100, true);

      const top = collector.getTopSlowEvents(2);

      expect(top.length).toBe(2);
      expect(top[0].eventType).toBe('slow');
      expect(top[1].eventType).toBe('medium');
    });
  });

  describe('getTopErrorEvents', () => {
    it('returns events with most errors', () => {
      collector.recordEventProcessed(createTestEvent('few-errors'), 100, true);
      collector.recordEventProcessed(createTestEvent('few-errors'), 100, false);
      collector.recordEventProcessed(createTestEvent('many-errors'), 100, false);
      collector.recordEventProcessed(createTestEvent('many-errors'), 100, false);
      collector.recordEventProcessed(createTestEvent('many-errors'), 100, false);

      const top = collector.getTopErrorEvents(2);

      expect(top.length).toBe(2);
      expect(top[0].eventType).toBe('many-errors');
      expect(top[0].failureCount).toBe(3);
    });
  });
});

describe('EventPerformanceMonitor', () => {
  let monitor: EventPerformanceMonitor;

  beforeEach(() => {
    monitor = new EventPerformanceMonitor();
    vi.useFakeTimers();
  });

  describe('wrapHandler', () => {
    it('wraps handler and records metrics', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const event = {
        id: 'evt-1',
        type: 'payment.created',
        aggregateId: 'pay-1',
        aggregateType: 'payment',
        version: 1,
        payload: {},
        metadata: {},
        occurredAt: new Date().toISOString(),
        sequenceNumber: 1,
        streamId: 'payment:pay-1',
      };

      const wrapped = monitor.wrapHandler('testHandler', handler);
      await wrapped(event);

      expect(handler).toHaveBeenCalledWith(event);

      const metrics = monitor.getMetrics().getHandlerMetrics('testHandler');
      expect(metrics?.totalProcessed).toBe(1);
      expect(metrics?.successCount).toBe(1);
    });

    it('records failure metrics when handler throws', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Failed'));
      const event = {
        id: 'evt-1',
        type: 'payment.created',
        aggregateId: 'pay-1',
        aggregateType: 'payment',
        version: 1,
        payload: {},
        metadata: {},
        occurredAt: new Date().toISOString(),
        sequenceNumber: 1,
        streamId: 'payment:pay-1',
      };

      const wrapped = monitor.wrapHandler('testHandler', handler);

      await expect(wrapped(event)).rejects.toThrow('Failed');

      const metrics = monitor.getMetrics().getHandlerMetrics('testHandler');
      expect(metrics?.failureCount).toBe(1);
    });

    it('does not record metrics when disabled', async () => {
      monitor.disable();
      const handler = vi.fn().mockResolvedValue(undefined);
      const event = {
        id: 'evt-1',
        type: 'payment.created',
        aggregateId: 'pay-1',
        aggregateType: 'payment',
        version: 1,
        payload: {},
        metadata: {},
        occurredAt: new Date().toISOString(),
        sequenceNumber: 1,
        streamId: 'payment:pay-1',
      };

      const wrapped = monitor.wrapHandler('testHandler', handler);
      await wrapped(event);

      const metrics = monitor.getMetrics().getHandlerMetrics('testHandler');
      expect(metrics).toBeUndefined();
    });

    it('enables and disables monitoring', () => {
      expect(monitor.isEnabled()).toBe(true);
      monitor.disable();
      expect(monitor.isEnabled()).toBe(false);
      monitor.enable();
      expect(monitor.isEnabled()).toBe(true);
    });
  });
});