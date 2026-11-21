/**
 * Issue #823 — Real-time WebSocket API for live updates
 *
 * Singleton broadcast helper.  Routes and services import `liveBroadcast` to
 * push typed events to connected clients without needing a direct reference to
 * the AgenticPayWebSocketServer instance.
 *
 * Supported channels (default subscriptions):
 *   payment.events    — payment created / updated / settled / failed
 *   dispute.updates   — dispute opened / resolved / escalated
 *   analytics.updates — periodic metric snapshots
 */

import type { AgenticPayWebSocketServer } from './server.js';
import type { WebSocketChannel, WebSocketOutboundMessage } from './types.js';

// ---------------------------------------------------------------------------
// Types for structured live events
// ---------------------------------------------------------------------------

export type PaymentLiveEvent = {
  type: 'payment.created' | 'payment.updated' | 'payment.settled' | 'payment.failed';
  payload: {
    paymentId: string;
    projectId?: string;
    amount?: string;
    currency?: string;
    status: string;
    timestamp: string;
    [key: string]: unknown;
  };
};

export type DisputeLiveEvent = {
  type: 'dispute.opened' | 'dispute.resolved' | 'dispute.escalated';
  payload: {
    disputeId: string;
    projectId?: string;
    resolution?: string;
    timestamp: string;
    [key: string]: unknown;
  };
};

export type AnalyticsLiveEvent = {
  type: 'analytics.snapshot';
  payload: {
    activeConnections: number;
    queueDepth?: number;
    sentMessages?: number;
    timestamp: string;
    [key: string]: unknown;
  };
};

export type LiveEvent = PaymentLiveEvent | DisputeLiveEvent | AnalyticsLiveEvent;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

let _wsServer: AgenticPayWebSocketServer | null = null;

/**
 * Called once from index.ts after `attachWebSocketServer` returns.
 * Must be called before any `liveBroadcast.*` helper is used.
 */
export function registerWebSocketServer(server: AgenticPayWebSocketServer): void {
  _wsServer = server;
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

function broadcast(channel: WebSocketChannel, event: LiveEvent): void {
  if (!_wsServer) return; // gracefully no-op when WS is disabled
  const message: WebSocketOutboundMessage = {
    type: event.type,
    channel,
    payload: event.payload,
  };
  _wsServer.broadcastToChannel(channel, { type: event.type, payload: event.payload });
}

export const liveBroadcast = {
  /** Broadcast a payment lifecycle event to the `payment.events` channel. */
  payment(event: PaymentLiveEvent): void {
    broadcast('payment.events', event);
  },

  /** Broadcast a dispute lifecycle event to the `dispute.updates` channel. */
  dispute(event: DisputeLiveEvent): void {
    broadcast('dispute.updates', event);
  },

  /** Broadcast an analytics snapshot to the `analytics.updates` channel. */
  analytics(event: AnalyticsLiveEvent): void {
    broadcast('analytics.updates', event);
  },

  /**
   * Low-level broadcast to any channel.
   * Useful for custom channels (e.g. `indexer.stellar.CONTRACT_ID`).
   */
  raw(channel: WebSocketChannel, message: Omit<WebSocketOutboundMessage, 'channel'>): void {
    _wsServer?.broadcastToChannel(channel, message);
  },
};
