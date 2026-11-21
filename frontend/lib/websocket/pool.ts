export type WebSocketPoolOptions = {
  url: string;
  channels?: string[];
  authExpiresAt?: string;
  maxBufferedAmountBytes?: number;
  maxQueueSize?: number;
  reconnect?: {
    initialDelayMs: number;
    maxDelayMs: number;
    jitterRatio: number;
  };
};

type Listener<T> = (value: T) => void;

type PoolState = {
  connected: boolean;
  reconnecting: boolean;
  lastError?: string;
  lastSequence?: number;
  droppedMessages?: number;
};

import { decodeServerBinary } from "./codec.js";

type OutboundItem = { data: string; priority: "high" | "normal" };
type WireMessage = {
  type: string;
  channel?: string;
  sequence?: number;
  sessionId?: string;
  emittedAt?: string;
  payload?: unknown;
};

export class WebSocketPool {
  private readonly options: Required<WebSocketPoolOptions>;
  private ws: WebSocket | null = null;
  private destroyed = false;

  private state: PoolState = { connected: false, reconnecting: false };
  private readonly stateListeners = new Set<Listener<PoolState>>();
  private readonly messageListeners = new Set<Listener<string>>();

  private readonly queueHigh: OutboundItem[] = [];
  private readonly queueNormal: OutboundItem[] = [];
  private readonly pendingBySequence = new Map<number, string>();
  private reconnectAttempt = 0;
  private expectedSequence = 1;
  private reconnectTimer: number | null = null;
  private flushTimer: number | null = null;

  constructor(options: WebSocketPoolOptions) {
    this.options = {
      url: options.url,
      channels: options.channels ?? ["payment.events", "dispute.updates"],
      authExpiresAt: options.authExpiresAt ?? "",
      maxBufferedAmountBytes: options.maxBufferedAmountBytes ?? 512 * 1024,
      maxQueueSize: options.maxQueueSize ?? 500,
      reconnect: options.reconnect ?? { initialDelayMs: 250, maxDelayMs: 10_000, jitterRatio: 0.25 },
    };
  }

  onState(listener: Listener<PoolState>): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  onMessage(listener: Listener<string>): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  connect(): void {
    if (this.destroyed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.setState({ connected: false, reconnecting: this.reconnectAttempt > 0 });
    const useBinary = this.options.url.includes("proto=1");
    const ws = new WebSocket(this.options.url);
    if (useBinary) ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.expectedSequence = 1;
      this.pendingBySequence.clear();
      this.setState({ connected: true, reconnecting: false });
      this.sendControl({ type: "subscribe", channels: this.options.channels });
      this.startFlushLoop();
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary protobuf frame — decode and re-serialize for existing ordered delivery
        const messages = decodeServerBinary(event.data);
        const json = messages.length === 1
          ? JSON.stringify(messages[0])
          : JSON.stringify(messages);
        this.deliverOrdered(json);
      } else {
        const data = typeof event.data === "string" ? event.data : "";
        this.deliverOrdered(data);
      }
    };

    ws.onerror = () => {
      this.setState({ ...this.state, lastError: "WebSocket error" });
    };

    ws.onclose = () => {
      this.setState({ connected: false, reconnecting: false });
      this.stopFlushLoop();
      this.scheduleReconnect();
    };
  }

  send(message: unknown, priority: "high" | "normal" = "normal"): { accepted: boolean; reason?: string } {
    const data = typeof message === "string" ? message : JSON.stringify(message);
    const total = this.queueHigh.length + this.queueNormal.length;
    if (total >= this.options.maxQueueSize) return { accepted: false, reason: "QUEUE_FULL" };

    const item: OutboundItem = { data, priority };
    if (priority === "high") this.queueHigh.push(item);
    else this.queueNormal.push(item);

    this.flushOnce();
    return { accepted: true };
  }

  subscribe(channels: string[]): void {
    this.sendControl({ type: "subscribe", channels });
  }

  unsubscribe(channels: string[]): void {
    this.sendControl({ type: "unsubscribe", channels });
  }

  refreshAuth(expiresAt: string): void {
    this.sendControl({ type: "auth.refresh", expiresAt });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.stopFlushLoop();
    this.ws?.close();
    this.ws = null;
    this.queueHigh.length = 0;
    this.queueNormal.length = 0;
  }

  private startFlushLoop(): void {
    if (this.flushTimer) return;
    this.flushTimer = window.setInterval(() => this.flushOnce(), 25);
  }

  private stopFlushLoop(): void {
    if (!this.flushTimer) return;
    window.clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  private flushOnce(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > this.options.maxBufferedAmountBytes) return;

    const next = this.queueHigh.shift() ?? this.queueNormal.shift();
    if (!next) return;

    ws.send(next.data);
  }

  private sendControl(message: unknown): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  private deliverOrdered(data: string): void {
    const messages = parseWireMessages(data);
    for (const message of messages) {
      if (typeof message.sequence !== "number") {
        this.emitMessage(JSON.stringify(message));
        continue;
      }

      this.pendingBySequence.set(message.sequence, JSON.stringify(message));
    }

    let delivered = false;
    while (this.pendingBySequence.has(this.expectedSequence)) {
      const next = this.pendingBySequence.get(this.expectedSequence)!;
      this.pendingBySequence.delete(this.expectedSequence);
      this.emitMessage(next);
      this.expectedSequence += 1;
      delivered = true;
    }

    if (!delivered && this.pendingBySequence.size > 100) {
      const nextSequence = Math.min(...this.pendingBySequence.keys());
      this.expectedSequence = nextSequence;
      this.setState({
        ...this.state,
        droppedMessages: (this.state.droppedMessages ?? 0) + 1,
      });
      this.deliverOrdered("[]");
    }

    this.setState({ ...this.state, lastSequence: this.expectedSequence - 1 });
  }

  private emitMessage(data: string): void {
    for (const listener of this.messageListeners) listener(data);
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) return;

    const { initialDelayMs, maxDelayMs, jitterRatio } = this.options.reconnect;
    const exponential = initialDelayMs * Math.pow(2, Math.min(6, this.reconnectAttempt));
    const baseDelay = Math.min(maxDelayMs, exponential);
    const jitter = baseDelay * jitterRatio * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(baseDelay + jitter));

    this.setState({ ...this.state, reconnecting: true });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt += 1;
      this.connect();
    }, delay);
  }

  private setState(next: PoolState): void {
    this.state = next;
    for (const listener of this.stateListeners) listener(next);
  }
}

function parseWireMessages(data: string): WireMessage[] {
  try {
    const parsed = JSON.parse(data) as WireMessage | WireMessage[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [{ type: "raw", payload: data }];
  }
}

const poolByUrl = new Map<string, WebSocketPool>();

export function getWebSocketPool(options: WebSocketPoolOptions): WebSocketPool {
  const existing = poolByUrl.get(options.url);
  if (existing) return existing;
  const created = new WebSocketPool(options);
  poolByUrl.set(options.url, created);
  return created;
}
