import type WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import type {
  WebSocketChannel,
  WebSocketOutboundMessage,
  WebSocketServerMetrics,
  WebSocketWireMessage,
} from './types.js';

type QueueItem = { json: string; priority: 'high' | 'normal' };

export class ManagedConnection {
  readonly sessionId = randomUUID();
  private readonly ws: WebSocket;
  private readonly metrics: WebSocketServerMetrics;
  private readonly maxQueueSize: number;
  private readonly maxBufferedAmountBytes: number;
  private readonly maxBatchSize: number;
  private readonly queueHigh: QueueItem[] = [];
  private readonly queueNormal: QueueItem[] = [];
  private readonly channels = new Set<WebSocketChannel>();
  private sequence = 0;
  private authExpiresAtMs: number | undefined;

  constructor(params: {
    ws: WebSocket;
    metrics: WebSocketServerMetrics;
    maxQueueSize: number;
    maxBufferedAmountBytes: number;
    maxBatchSize: number;
    defaultChannels: WebSocketChannel[];
    authExpiresAtMs?: number;
  }) {
    this.ws = params.ws;
    this.metrics = params.metrics;
    this.maxQueueSize = params.maxQueueSize;
    this.maxBufferedAmountBytes = params.maxBufferedAmountBytes;
    this.maxBatchSize = params.maxBatchSize;
    this.authExpiresAtMs = params.authExpiresAtMs;

    for (const channel of params.defaultChannels) {
      this.subscribe(channel);
    }
  }

  enqueue(message: WebSocketOutboundMessage): { accepted: boolean; reason?: string } {
    if (message.channel && !this.channels.has(message.channel)) {
      return { accepted: false, reason: 'NOT_SUBSCRIBED' };
    }

    const priority = message.priority === 'high' ? 'high' : 'normal';
    const wireMessage: WebSocketWireMessage = {
      type: message.type,
      channel: message.channel,
      payload: message.payload,
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      emittedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(wireMessage);

    const totalSize = this.queueHigh.length + this.queueNormal.length;
    if (totalSize >= this.maxQueueSize) {
      this.metrics.droppedMessages += 1;
      return { accepted: false, reason: 'QUEUE_FULL' };
    }

    const item: QueueItem = { json, priority };
    if (priority === 'high') {
      this.queueHigh.push(item);
    } else {
      this.queueNormal.push(item);
    }

    this.metrics.enqueuedMessages += 1;
    return { accepted: true };
  }

  subscribe(channel: WebSocketChannel): void {
    if (this.channels.has(channel)) return;
    this.channels.add(channel);
    this.metrics.subscribedChannels[channel] = (this.metrics.subscribedChannels[channel] ?? 0) + 1;
  }

  unsubscribe(channel: WebSocketChannel): void {
    if (!this.channels.delete(channel)) return;
    const next = Math.max(0, (this.metrics.subscribedChannels[channel] ?? 0) - 1);
    if (next === 0) delete this.metrics.subscribedChannels[channel];
    else this.metrics.subscribedChannels[channel] = next;
  }

  hasChannel(channel: WebSocketChannel): boolean {
    return this.channels.has(channel);
  }

  refreshAuth(expiresAtMs?: number): void {
    this.authExpiresAtMs = expiresAtMs;
  }

  isAuthExpired(now = Date.now()): boolean {
    return this.authExpiresAtMs !== undefined && now >= this.authExpiresAtMs;
  }

  close(): void {
    for (const channel of [...this.channels]) {
      this.unsubscribe(channel);
    }
  }

  flush(): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    if (this.ws.bufferedAmount > this.maxBufferedAmountBytes) return;

    const batch: string[] = [];
    while (batch.length < this.maxBatchSize) {
      const next = this.queueHigh.shift() ?? this.queueNormal.shift();
      if (!next) break;
      batch.push(next.json);
    }

    if (batch.length === 0) return;

    // A single frame keeps slow clients from amplifying CPU overhead.
    const payload = batch.length === 1 ? batch[0] : `[${batch.join(',')}]`;
    this.ws.send(payload);
    this.metrics.sentMessages += batch.length;
  }

  getQueuedCount(): number {
    return this.queueHigh.length + this.queueNormal.length;
  }
}
