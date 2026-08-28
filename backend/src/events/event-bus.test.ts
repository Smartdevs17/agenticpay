import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  subscribe,
  subscribeAll,
  publish,
  clearHandlers,
  bindWebSocketServer,
} from './event-bus';
import { eventSchemaRegistry } from './schemas/index.js';
import type { StoredEvent } from './event-types';

describe('EventBus', () => {
  beforeEach(() => {
    clearHandlers();
    vi.clearAllMocks();
    // Bypass schema validation for unit tests – individual validation tests can override
    vi.spyOn(eventSchemaRegistry, 'hasSchema').mockReturnValue(false);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    clearHandlers();
    // Re-register projections after clearing, so other test suites aren't affected
    try {
      const { resetProjectionsRegistration, registerProjections } = await import('./projections.js');
      resetProjectionsRegistration();
      registerProjections();
    } catch {}
  });

  describe('subscribe', () => {
    it('registers a handler for an event type', async () => {
      const handler = vi.fn();
      const unsubscribe = subscribe('payment.created', handler);

      const event: StoredEvent = {
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
      };

      await publish(event);

      expect(handler).toHaveBeenCalledWith(event);
      unsubscribe();
    });

    it('allows multiple handlers for same event type', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      subscribe('payment.created', handler1);
      subscribe('payment.created', handler2);

      const event: StoredEvent = {
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
      };

      await publish(event);

      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
    });

    it('returns unsubscribe function', () => {
      const handler = vi.fn();
      const unsubscribe = subscribe('payment.created', handler);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();

      const event: StoredEvent = {
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
      };

      publish(event);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('subscribeAll', () => {
    it('receives all events regardless of type', async () => {
      const wildcardHandler = vi.fn();
      subscribeAll(wildcardHandler);

      const event1: StoredEvent = {
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
      };

      const event2: StoredEvent = {
        id: 'evt-2',
        type: 'project.created',
        aggregateId: 'proj-1',
        aggregateType: 'project',
        version: 1,
        payload: { client: 'C', amount: 500 },
        metadata: {},
        occurredAt: new Date().toISOString(),
        sequenceNumber: 2,
        streamId: 'project:proj-1',
      };

      await publish(event1);
      await publish(event2);

      expect(wildcardHandler).toHaveBeenCalledTimes(2);
      expect(wildcardHandler).toHaveBeenCalledWith(event1);
      expect(wildcardHandler).toHaveBeenCalledWith(event2);
    });
  });

  describe('publish', () => {
    it('publishes event to matching handlers', async () => {
      const handler = vi.fn();
      subscribe('payment.created', handler);

      const event: StoredEvent = {
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
      };

      await publish(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('does not call handlers for different event types', async () => {
      const handler = vi.fn();
      subscribe('payment.created', handler);

      const event: StoredEvent = {
        id: 'evt-1',
        type: 'project.created',
        aggregateId: 'proj-1',
        aggregateType: 'project',
        version: 1,
        payload: { client: 'C', amount: 500 },
        metadata: {},
        occurredAt: new Date().toISOString(),
        sequenceNumber: 1,
        streamId: 'project:proj-1',
      };

      await publish(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it('handles handler errors gracefully', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Handler failed'));
      const successHandler = vi.fn();
      subscribe('payment.created', errorHandler);
      subscribe('payment.created', successHandler);

      const event: StoredEvent = {
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
      };

      await publish(event);

      expect(errorHandler).toHaveBeenCalled();
      expect(successHandler).toHaveBeenCalled();
    });
  });

  describe('WebSocket integration', () => {
    it('broadcasts to WebSocket channel for payment events', async () => {
      const mockBroadcast = vi.fn();
      const mockServer = {
        broadcastToChannel: mockBroadcast,
      };
      bindWebSocketServer(mockServer as any);

      const event: StoredEvent = {
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
      };

      await publish(event);

      expect(mockBroadcast).toHaveBeenCalledWith('payment.events', {
        type: 'payment.created',
        payload: event,
        priority: 'normal',
      });
    });

    it('broadcasts to dispute channel for dispute events', async () => {
      const mockBroadcast = vi.fn();
      const mockServer = {
        broadcastToChannel: mockBroadcast,
      };
      bindWebSocketServer(mockServer as any);

      const event: StoredEvent = {
        id: 'evt-1',
        type: 'dispute.created',
        aggregateId: 'disp-1',
        aggregateType: 'dispute',
        version: 1,
        payload: { reason: 'test' },
        metadata: {},
        occurredAt: new Date().toISOString(),
        sequenceNumber: 1,
        streamId: 'dispute:disp-1',
      };

      await publish(event);

      expect(mockBroadcast).toHaveBeenCalledWith('dispute.updates', {
        type: 'dispute.created',
        payload: event,
        priority: 'high',
      });
    });
  });

  describe('clearHandlers', () => {
    it('clears all handlers and WebSocket server', () => {
      const handler = vi.fn();
      subscribe('payment.created', handler);
      bindWebSocketServer({ broadcastToChannel: vi.fn() } as any);

      clearHandlers();

      const event: StoredEvent = {
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
      };

      publish(event);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});