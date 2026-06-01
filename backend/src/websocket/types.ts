export type WebSocketEventPriority = 'high' | 'normal';
export type WebSocketChannel = 'payment.events' | 'dispute.updates' | 'analytics.updates' | string;

export type WebSocketOutboundMessage = {
  type: string;
  channel?: WebSocketChannel;
  payload?: unknown;
  priority?: WebSocketEventPriority;
};

export type WebSocketClientMessage =
  | { type: 'subscribe'; channels: WebSocketChannel[] }
  | { type: 'unsubscribe'; channels: WebSocketChannel[] }
  | { type: 'auth.refresh'; expiresAt?: string }
  | { type: 'ping' };

export type WebSocketWireMessage = Omit<WebSocketOutboundMessage, 'priority'> & {
  sequence: number;
  sessionId: string;
  emittedAt: string;
};

export type WebSocketServerMetrics = {
  activeConnections: number;
  acceptedConnections: number;
  rejectedConnections: number;
  closedConnections: number;
  enqueuedMessages: number;
  droppedMessages: number;
  sentMessages: number;
  subscribedChannels: Record<string, number>;
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
  defaultChannels: WebSocketChannel[];
  maxAuthAgeMs: number;
  /** When true, clients that opt in via ?proto=1 receive binary protobuf frames instead of JSON. */
  enableBinaryProtocol?: boolean;
};
