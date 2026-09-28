/**
 * Issue #823 — Real-time WebSocket API — unit tests
 *
 * Tests cover:
 *   - liveBroadcast no-ops gracefully when no server is registered
 *   - liveBroadcast.payment / dispute / analytics delegate to broadcastToChannel
 *   - liveBroadcast.raw passes channel and message verbatim
 *   - registerWebSocketServer wires the singleton
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerWebSocketServer,
  liveBroadcast,
  type PaymentLiveEvent,
  type DisputeLiveEvent,
  type AnalyticsLiveEvent,
} from '../live-broadcast.js';
import type { AgenticPayWebSocketServer } from '../server.js';

function makeStubServer(): AgenticPayWebSocketServer & { calls: { channel: string; message: unknown }[] } {
  const calls: { channel: string; message: unknown }[] = [];
  return {
    calls,
    wss: {} as any,
    metrics: {
      activeConnections: 3,
      acceptedConnections: 10,
      rejectedConnections: 0,
      closedConnections: 7,
      enqueuedMessages: 5,
      droppedMessages: 0,
      sentMessages: 42,
      subscribedChannels: { 'payment.events': 2, 'dispute.updates': 1 },
    },
    broadcast: vi.fn(),
    broadcastToChannel(channel, message) {
      calls.push({ channel, message });
    },
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// Reset the singleton between tests by re-registering with null-ish stub
beforeEach(() => {
  // Register a fresh stub so each test starts clean
});

describe('liveBroadcast — no server registered', () => {
  it('does not throw when no server has been registered', () => {
    // Force the module to have no server by registering undefined cast
    // We can't easily reset the module singleton in Vitest without mocking the
    // module, so instead we verify it doesn't throw with a real stub missing.
    expect(() => {
      liveBroadcast.raw('payment.events', { type: 'payment.created' });
    }).not.toThrow();
  });
});

describe('liveBroadcast — with registered server', () => {
  let stub: ReturnType<typeof makeStubServer>;

  beforeEach(() => {
    stub = makeStubServer();
    registerWebSocketServer(stub);
  });

  it('liveBroadcast.payment sends to payment.events channel', () => {
    const event: PaymentLiveEvent = {
      type: 'payment.created',
      payload: { paymentId: 'pay_1', status: 'pending', timestamp: '2026-01-01T00:00:00Z' },
    };
    liveBroadcast.payment(event);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].channel).toBe('payment.events');
    expect((stub.calls[0].message as any).type).toBe('payment.created');
  });

  it('liveBroadcast.dispute sends to dispute.updates channel', () => {
    const event: DisputeLiveEvent = {
      type: 'dispute.opened',
      payload: { disputeId: 'dis_1', timestamp: '2026-01-01T00:00:00Z' },
    };
    liveBroadcast.dispute(event);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].channel).toBe('dispute.updates');
    expect((stub.calls[0].message as any).type).toBe('dispute.opened');
  });

  it('liveBroadcast.analytics sends to analytics.updates channel', () => {
    const event: AnalyticsLiveEvent = {
      type: 'analytics.snapshot',
      payload: { activeConnections: 3, timestamp: '2026-01-01T00:00:00Z' },
    };
    liveBroadcast.analytics(event);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].channel).toBe('analytics.updates');
  });

  it('liveBroadcast.raw sends to arbitrary channel verbatim', () => {
    liveBroadcast.raw('indexer.stellar.CONTRACT_ID', {
      type: 'indexer.event',
      payload: { txHash: '0xabc' },
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].channel).toBe('indexer.stellar.CONTRACT_ID');
    expect((stub.calls[0].message as any).payload).toEqual({ txHash: '0xabc' });
  });

  it('liveBroadcast.payment includes full payload', () => {
    const event: PaymentLiveEvent = {
      type: 'payment.settled',
      payload: {
        paymentId: 'pay_2',
        projectId: 'proj_1',
        amount: '100.00',
        currency: 'XLM',
        status: 'settled',
        timestamp: '2026-01-02T00:00:00Z',
      },
    };
    liveBroadcast.payment(event);
    const { message } = stub.calls[0];
    expect((message as any).payload).toMatchObject({
      paymentId: 'pay_2',
      amount: '100.00',
      currency: 'XLM',
    });
  });
});
