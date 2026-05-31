import type http from 'node:http';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import { ManagedConnection } from './managedConnection.js';
import type {
  WebSocketChannel,
  WebSocketClientMessage,
  WebSocketOutboundMessage,
  WebSocketServerMetrics,
  WebSocketServerOptions,
} from './types.js';
import type { WebSocketScalingAdapter } from './scaling.js';

export type AgenticPayWebSocketServer = {
  wss: WebSocketServer;
  metrics: WebSocketServerMetrics;
  broadcast: (message: WebSocketOutboundMessage) => void;
  broadcastToChannel: (channel: WebSocketChannel, message: Omit<WebSocketOutboundMessage, 'channel'>) => void;
  close: () => Promise<void>;
};

function createMetrics(): WebSocketServerMetrics {
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

function parseAuthExpiry(value: string | null, maxAuthAgeMs: number): number {
  if (!value) return Date.now() + maxAuthAgeMs;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Date.now() + maxAuthAgeMs;
}

function parseClientMessage(raw: WebSocket.RawData): WebSocketClientMessage | null {
  try {
    const value = JSON.parse(raw.toString()) as WebSocketClientMessage;
    if (value && typeof value.type === 'string') return value;
  } catch {
    return null;
  }
  return null;
}

export function attachWebSocketServer(params: {
  server: http.Server;
  options?: Partial<WebSocketServerOptions>;
  scaling?: WebSocketScalingAdapter;
}): AgenticPayWebSocketServer {
  const options: WebSocketServerOptions = {
    path: '/ws',
    maxConnections: 250,
    maxQueueSizePerConnection: 500,
    maxBufferedAmountBytes: 512 * 1024,
    flushIntervalMs: 25,
    maxBatchSize: 50,
    pingIntervalMs: 30_000,
    pongTimeoutMs: 10_000,
    defaultChannels: ['payment.events', 'dispute.updates', 'analytics.updates'],
    maxAuthAgeMs: 60 * 60 * 1000,
    enableBinaryProtocol: true,
    ...params.options,
  };

  const metrics = createMetrics();
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map<WebSocket, ManagedConnection>();
  const lastPongAt = new Map<WebSocket, number>();
  let unsubscribeScaling: (() => void) | undefined;

  params.server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname !== options.path) return;

      if (metrics.activeConnections >= options.maxConnections) {
        metrics.rejectedConnections += 1;
        metrics.lastOverloadAtMs = Date.now();
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, req) => {
    metrics.activeConnections += 1;
    metrics.acceptedConnections += 1;
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);

    const managed = new ManagedConnection({
      ws,
      metrics,
      maxQueueSize: options.maxQueueSizePerConnection,
      maxBufferedAmountBytes: options.maxBufferedAmountBytes,
      maxBatchSize: options.maxBatchSize,
      defaultChannels: options.defaultChannels,
      authExpiresAtMs: parseAuthExpiry(url.searchParams.get('expiresAt'), options.maxAuthAgeMs),
      useBinary: options.enableBinaryProtocol && url.searchParams.get('proto') === '1',
    });

    connections.set(ws, managed);
    lastPongAt.set(ws, Date.now());

    ws.on('pong', () => lastPongAt.set(ws, Date.now()));

    ws.on('message', (raw) => {
      const message = parseClientMessage(raw);
      if (!message) return;

      if (message.type === 'subscribe') {
        for (const channel of message.channels.slice(0, 25)) managed.subscribe(channel);
        managed.enqueue({ type: 'subscription.updated', payload: { channels: message.channels }, priority: 'high' });
      } else if (message.type === 'unsubscribe') {
        for (const channel of message.channels) managed.unsubscribe(channel);
        managed.enqueue({ type: 'subscription.updated', payload: { channels: message.channels }, priority: 'high' });
      } else if (message.type === 'auth.refresh') {
        managed.refreshAuth(parseAuthExpiry(message.expiresAt ?? null, options.maxAuthAgeMs));
        managed.enqueue({ type: 'auth.refreshed', priority: 'high' });
      } else if (message.type === 'ping') {
        managed.enqueue({ type: 'pong', priority: 'high' });
      }
    });

    ws.on('close', () => {
      managed.close();
      connections.delete(ws);
      lastPongAt.delete(ws);
      metrics.activeConnections = Math.max(0, metrics.activeConnections - 1);
      metrics.closedConnections += 1;
    });
  });

  const flushTimer = setInterval(() => {
    for (const managed of connections.values()) {
      managed.flush();
    }
  }, options.flushIntervalMs);

  const pingTimer = setInterval(() => {
    const now = Date.now();
    for (const ws of connections.keys()) {
      if (ws.readyState !== ws.OPEN) continue;
      const lastPong = lastPongAt.get(ws) ?? 0;
      if (now - lastPong > options.pingIntervalMs + options.pongTimeoutMs) {
        ws.terminate();
        continue;
      }
      const managed = connections.get(ws);
      if (managed?.isAuthExpired(now)) {
        managed.enqueue({ type: 'auth.expired', priority: 'high' });
        ws.close(4001, 'Auth token expired');
        continue;
      }
      ws.ping();
    }
  }, options.pingIntervalMs);

  const broadcastLocal = (message: WebSocketOutboundMessage) => {
    for (const managed of connections.values()) {
      managed.enqueue(message);
    }
  };

  const broadcast = (message: WebSocketOutboundMessage) => {
    broadcastLocal(message);
    void params.scaling?.publish(message);
  };

  const broadcastToChannel = (
    channel: WebSocketChannel,
    message: Omit<WebSocketOutboundMessage, 'channel'>
  ) => broadcast({ ...message, channel });

  if (params.scaling) {
    Promise.resolve(params.scaling.subscribe((message) => broadcastLocal(message)))
      .then((unsubscribe) => {
        unsubscribeScaling = unsubscribe;
      })
      .catch(() => {
        metrics.lastOverloadAtMs = Date.now();
      });
  }

  const close = async () => {
    clearInterval(flushTimer);
    clearInterval(pingTimer);
    unsubscribeScaling?.();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  };

  return { wss, metrics, broadcast, broadcastToChannel, close };
}
