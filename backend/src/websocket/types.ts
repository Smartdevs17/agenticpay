export type WebSocketEventPriority = 'high' | 'normal';

export type WebSocketOutboundMessage = {
  type: string;
  payload?: unknown;
  priority?: WebSocketEventPriority;
};

export type WebSocketServerMetrics = {
  activeConnections: number;
  acceptedConnections: number;
  rejectedConnections: number;
  closedConnections: number;
  enqueuedMessages: number;
  droppedMessages: number;
  sentMessages: number;
  lastOverloadAtMs?: number;
};

export type WebSocketServerOptions = {
  path: string;
  maxConnections: number;
  maxQueueSizePerConnection: number;
  maxBufferedAmountBytes: number;
  flushIntervalMs: number;
  maxBatchSize: number;
  pingIntervalMs: number;
  pongTimeoutMs: number;
};

