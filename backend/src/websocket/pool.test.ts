import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { WebSocketConnectionPool } from './pool';
import type { WebSocketServerMetrics } from './types';

function metrics(): WebSocketServerMetrics {
  return {
    activeConnections: 0,
    acceptedConnections: 0,
    rejectedConnections: 0,
    closedConnections: 0,
    enqueuedMessages: 0,
    droppedMessages: 0,
    sentMessages: 0,
    subscribedChannels: {},
  };
}

function socket() {
  const ws = new EventEmitter() as any;
  ws.OPEN = 1;
  ws.readyState = 1;
  ws.bufferedAmount = 0;
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.terminate = vi.fn();
  return ws;
}

describe('WebSocketConnectionPool', () => {
  it('tracks accepted and closed connections', () => {
    const poolMetrics = metrics();
    const pool = new WebSocketConnectionPool(poolMetrics, {
      maxConnections: 2,
      maxQueueSizePerConnection: 10,
      maxBufferedAmountBytes: 1024,
      maxBatchSize: 5,
      defaultChannels: ['payment.events'],
    });

    const ws = socket();
    pool.addConnection({ ws });

    expect(pool.size).toBe(1);
    expect(poolMetrics.activeConnections).toBe(1);
    expect(poolMetrics.acceptedConnections).toBe(1);
    expect(poolMetrics.subscribedChannels['payment.events']).toBe(1);

    expect(pool.removeConnection(ws)).toBe(true);
    expect(poolMetrics.activeConnections).toBe(0);
    expect(poolMetrics.closedConnections).toBe(1);
    expect(poolMetrics.subscribedChannels['payment.events']).toBeUndefined();
  });

  it('rejects connections above capacity', () => {
    const poolMetrics = metrics();
    const pool = new WebSocketConnectionPool(poolMetrics, {
      maxConnections: 1,
      maxQueueSizePerConnection: 10,
      maxBufferedAmountBytes: 1024,
      maxBatchSize: 5,
      defaultChannels: [],
    });

    pool.addConnection({ ws: socket() });

    expect(() => pool.addConnection({ ws: socket() })).toThrow('WEBSOCKET_POOL_EXHAUSTED');
    expect(poolMetrics.rejectedConnections).toBe(1);
    expect(pool.snapshot().saturated).toBe(true);
  });

  it('broadcasts subscribed messages in batches', () => {
    const poolMetrics = metrics();
    const pool = new WebSocketConnectionPool(poolMetrics, {
      maxConnections: 2,
      maxQueueSizePerConnection: 10,
      maxBufferedAmountBytes: 1024,
      maxBatchSize: 10,
      defaultChannels: ['analytics.updates'],
    });
    const wsA = socket();
    const wsB = socket();
    pool.addConnection({ ws: wsA });
    pool.addConnection({ ws: wsB });

    const accepted = pool.broadcast({
      type: 'metric.updated',
      channel: 'analytics.updates',
      payload: { p95: 40 },
    });

    expect(accepted).toBe(2);
    expect(pool.snapshot().queuedMessages).toBe(2);

    pool.flushAll();

    expect(wsA.send).toHaveBeenCalledOnce();
    expect(wsB.send).toHaveBeenCalledOnce();
    expect(poolMetrics.sentMessages).toBe(2);
  });
});
