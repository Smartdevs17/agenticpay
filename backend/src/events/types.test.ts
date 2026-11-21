import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { TypedEventBus, typedEventBus } from './types';
import { clearHandlers } from './event-bus';
import { clearEventStore } from './event-store';
import { eventSchemaRegistry } from './schemas/index.js';

describe('TypedEventBus', () => {
  beforeEach(() => {
    clearHandlers();
    clearEventStore();
    vi.clearAllMocks();
    vi.spyOn(eventSchemaRegistry, 'hasSchema').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearHandlers();
  });

  describe('subscribe', () => {
    it('subscribes to typed event', async () => {
      const bus = new TypedEventBus();
      const handler = vi.fn();
      const unsub = bus.subscribe('payment.created', handler);

      expect(typeof unsub).toBe('function');

      const { appendEvent } = await import('./event-store.js');
      const event = appendEvent('payment', 'pay-1', 'payment.created', {
        from: 'A',
        to: 'B',
        amount: 100,
        asset: 'USDC',
        trigger: { type: 'immediate' },
      } as any);

      await bus.publish(event as any);

      expect(handler).toHaveBeenCalledWith(event);
      unsub();
    });

    it('supports subscribeAll', async () => {
      const bus = new TypedEventBus();
      const handler = vi.fn();
      bus.subscribeAll(handler);

      const { appendEvent } = await import('./event-store.js');
      const e1 = appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      const e2 = appendEvent('project', 'proj-1', 'project.created', { client: 'C', amount: 500 } as any);

      await bus.publish(e1 as any);
      await bus.publish(e2 as any);

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('publish', () => {
    it('publishes typed event', async () => {
      const bus = new TypedEventBus();
      const handler = vi.fn();
      bus.subscribe('payment.created', handler);

      const { appendEvent } = await import('./event-store.js');
      const event = appendEvent('payment', 'pay-1', 'payment.created', {
        from: 'A',
        to: 'B',
        amount: 100,
        asset: 'USDC',
      } as any);

      await bus.publish(event as any);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('validates schema when available', async () => {
      const bus = new TypedEventBus();
      vi.spyOn(eventSchemaRegistry, 'hasSchema').mockReturnValue(true);
      vi.spyOn(eventSchemaRegistry, 'safeValidate').mockReturnValue({
        success: false,
        error: { errors: [{ message: 'invalid' }] } as any,
      });

      const { appendEvent } = await import('./event-store.js');
      const event = appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);

      await expect(bus.publish(event as any)).rejects.toThrow('Event schema validation failed');
    });
  });

  describe('emit', () => {
    it('creates and publishes event', async () => {
      const bus = new TypedEventBus();
      const handler = vi.fn();
      bus.subscribe('payment.created', handler);

      const event = await bus.emit('payment.created', 'payment', 'pay-1', {
        from: 'A',
        to: 'B',
        amount: 100,
        asset: 'USDC',
      } as any);

      expect(event.aggregateId).toBe('pay-1');
      expect(event.type).toBe('payment.created');
      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe('singleton', () => {
    it('typedEventBus is singleton instance of TypedEventBus', () => {
      expect(typedEventBus).toBeInstanceOf(TypedEventBus);
    });
  });
});
