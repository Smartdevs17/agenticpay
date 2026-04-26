import type WebSocket from 'ws';
import type { WebSocketOutboundMessage, WebSocketServerMetrics } from './types.js';

type QueueItem = { json: string; priority: 'high' | 'normal' };

export class ManagedConnection {
  private readonly ws: WebSocket;
  private readonly metrics: WebSocketServerMetrics;
  private readonly maxQueueSize: number;
  private readonly maxBufferedAmountBytes: number;
  private readonly maxBatchSize: number;
  private readonly queueHigh: QueueItem[] = [];
  private readonly queueNormal: QueueItem[] = [];

  constructor(params: {
    ws: WebSocket;
    metrics: WebSocketServerMetrics;
    maxQueueSize: number;
    maxBufferedAmountBytes: number;
    maxBatchSize: number;
  }) {
    this.ws = params.ws;
    this.metrics = params.metrics;
    this.maxQueueSize = params.maxQueueSize;
    this.maxBufferedAmountBytes = params.maxBufferedAmountBytes;
    this.maxBatchSize = params.maxBatchSize;
  }

  enqueue(message: WebSocketOutboundMessage): { accepted: boolean; reason?: string } {
    const priority = message.priority === 'high' ? 'high' : 'normal';
    const json = JSON.stringify({ ...message, priority: undefined });

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

