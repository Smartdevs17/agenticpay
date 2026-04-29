import type http from 'node:http';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import { ManagedConnection } from './managedConnection.js';
import type { WebSocketOutboundMessage, WebSocketServerMetrics, WebSocketServerOptions } from './types.js';

export type AgenticPayWebSocketServer = {
  wss: WebSocketServer;
  metrics: WebSocketServerMetrics;
  broadcast: (message: WebSocketOutboundMessage) => void;
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
  };
}

export function attachWebSocketServer(params: {
  server: http.Server;
  options?: Partial<WebSocketServerOptions>;
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
    ...params.options,
  };

  const metrics = createMetrics();
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map<WebSocket, ManagedConnection>();
  const lastPongAt = new Map<WebSocket, number>();

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

  wss.on('connection', (ws: WebSocket) => {
    metrics.activeConnections += 1;
    metrics.acceptedConnections += 1;

    const managed = new ManagedConnection({
      ws,
      metrics,
      maxQueueSize: options.maxQueueSizePerConnection,
      maxBufferedAmountBytes: options.maxBufferedAmountBytes,
      maxBatchSize: options.maxBatchSize,
    });

    connections.set(ws, managed);
    lastPongAt.set(ws, Date.now());

    ws.on('pong', () => lastPongAt.set(ws, Date.now()));

    ws.on('message', () => {
      // Reserved for future client->server messages (e.g. subscriptions / acks).
      // Intentionally a no-op to avoid unbounded per-message CPU for now.
    });

    ws.on('close', () => {
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
      ws.ping();
    }
  }, options.pingIntervalMs);

  const broadcast = (message: WebSocketOutboundMessage) => {
    for (const managed of connections.values()) {
      managed.enqueue(message);
    }
  };

  const close = async () => {
    clearInterval(flushTimer);
    clearInterval(pingTimer);
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  };

  return { wss, metrics, broadcast, close };
}

