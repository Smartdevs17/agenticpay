import type WebSocket from 'ws';
import { ManagedConnection } from './managedConnection.js';
import type {
  WebSocketChannel,
  WebSocketOutboundMessage,
  WebSocketServerMetrics,
} from './types.js';

export interface WebSocketConnectionPoolOptions {
  maxConnections: number;
  maxQueueSizePerConnection: number;
  maxBufferedAmountBytes: number;
  maxBatchSize: number;
  defaultChannels: WebSocketChannel[];
}

export interface AddConnectionParams {
  ws: WebSocket;
  authExpiresAtMs?: number;
  useBinary?: boolean;
}

export interface WebSocketConnectionPoolSnapshot {
  activeConnections: number;
  queuedMessages: number;
  averageQueuedMessages: number;
  saturated: boolean;
}

export class WebSocketConnectionPool {
  private readonly connections = new Map<WebSocket, ManagedConnection>();

  constructor(
    private readonly metrics: WebSocketServerMetrics,
    private readonly options: WebSocketConnectionPoolOptions,
  ) {}

  get size(): number {
    return this.connections.size;
  }

  canAccept(): boolean {
    return this.connections.size < this.options.maxConnections;
  }

  addConnection(params: AddConnectionParams): ManagedConnection {
    if (!this.canAccept()) {
      this.metrics.rejectedConnections += 1;
      this.metrics.lastOverloadAtMs = Date.now();
      throw new Error('WEBSOCKET_POOL_EXHAUSTED');
    }

    const managed = new ManagedConnection({
      ws: params.ws,
      metrics: this.metrics,
      maxQueueSize: this.options.maxQueueSizePerConnection,
      maxBufferedAmountBytes: this.options.maxBufferedAmountBytes,
      maxBatchSize: this.options.maxBatchSize,
      defaultChannels: this.options.defaultChannels,
      authExpiresAtMs: params.authExpiresAtMs,
      useBinary: params.useBinary,
    });

    this.connections.set(params.ws, managed);
    this.metrics.activeConnections = this.connections.size;
    this.metrics.acceptedConnections += 1;
    return managed;
  }

  getConnection(ws: WebSocket): ManagedConnection | undefined {
    return this.connections.get(ws);
  }

  removeConnection(ws: WebSocket): boolean {
    const managed = this.connections.get(ws);
    if (!managed) return false;

    managed.close();
    this.connections.delete(ws);
    this.metrics.activeConnections = this.connections.size;
    this.metrics.closedConnections += 1;
    return true;
  }

  broadcast(message: WebSocketOutboundMessage): number {
    let accepted = 0;
    for (const managed of this.connections.values()) {
      if (managed.enqueue(message).accepted) accepted += 1;
    }
    return accepted;
  }

  flushAll(): void {
    for (const managed of this.connections.values()) {
      managed.flush();
    }
  }

  closeAll(code = 1001, reason = 'Server shutting down'): void {
    for (const ws of this.connections.keys()) {
      try {
        ws.close(code, reason);
      } catch {
        ws.terminate();
      }
      this.removeConnection(ws);
    }
  }

  values(): IterableIterator<ManagedConnection> {
    return this.connections.values();
  }

  sockets(): IterableIterator<WebSocket> {
    return this.connections.keys();
  }

  snapshot(): WebSocketConnectionPoolSnapshot {
    let queuedMessages = 0;
    for (const managed of this.connections.values()) {
      queuedMessages += managed.getQueuedCount();
    }

    return {
      activeConnections: this.connections.size,
      queuedMessages,
      averageQueuedMessages: this.connections.size === 0 ? 0 : queuedMessages / this.connections.size,
      saturated: !this.canAccept(),
    };
  }
}
