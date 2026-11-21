export type SdkWebSocketOptions = {
  url: string;
  channels?: string[];
  token?: string;
  onTokenRefresh?: () => Promise<string>;
  reconnect?: {
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
};

export type MessageHandler = (type: string, payload: unknown, channel?: string) => void;

type WireMessage = {
  type: string;
  channel?: string;
  payload?: unknown;
  sessionId?: string;
  sequence?: number;
};

/**
 * Platform-agnostic WebSocket client for SDK consumers.
 *
 * Compatible with browser (uses global WebSocket) and Node.js environments
 * (inject a WebSocket implementation via options). Implements:
 * - Exponential backoff capped at maxDelayMs (default 5 min, per #477 AC)
 * - Auth token refresh on auth.expired server messages
 * - Subscribe/unsubscribe channel management
 */
export class AgenticPayWebSocket {
  private ws: WebSocket | null = null;
  private destroyed = false;
  private reconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private channels: Set<string>;
  private readonly handlers = new Set<MessageHandler>();
  private readonly options: Required<Pick<SdkWebSocketOptions, 'url' | 'channels'>> &
    SdkWebSocketOptions;

  constructor(options: SdkWebSocketOptions) {
    this.options = {
      channels: ['payment.events'],
      ...options,
    };
    this.channels = new Set(this.options.channels);
    this.reconnectDelay = options.reconnect?.initialDelayMs ?? 250;
  }

  connect(): void {
    if (this.destroyed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    const url = this.buildUrl();
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = this.options.reconnect?.initialDelayMs ?? 250;
      this.ws!.send(JSON.stringify({ type: 'subscribe', channels: Array.from(this.channels) }));
    };

    this.ws.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : null;
      if (!raw) return;
      try {
        const message = JSON.parse(raw) as WireMessage;
        if (message.type === 'auth.expired') this.handleAuthExpiry();
        for (const handler of this.handlers) {
          handler(message.type, message.payload, message.channel);
        }
      } catch {
        // Non-JSON frame — ignore
      }
    };

    this.ws.onerror = () => {
      // Error always followed by onclose — schedule reconnect there
    };

    this.ws.onclose = () => {
      if (!this.destroyed) this.scheduleReconnect();
    };
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  subscribe(channel: string): void {
    this.channels.add(channel);
    this.send('subscribe', { channels: [channel] });
  }

  unsubscribe(channel: string): void {
    this.channels.delete(channel);
    this.send('unsubscribe', { channels: [channel] });
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(type: string, payload?: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, ...(payload !== undefined ? { payload } : {}) }));
  }

  private buildUrl(): string {
    const url = new URL(this.options.url);
    if (this.options.token) url.searchParams.set('token', this.options.token);
    return url.toString();
  }

  private scheduleReconnect(): void {
    const maxDelay = this.options.reconnect?.maxDelayMs ?? 300_000;
    const jitter = this.reconnectDelay * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.min(this.reconnectDelay + jitter, maxDelay);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);

    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, maxDelay);
  }

  private handleAuthExpiry(): void {
    if (!this.options.onTokenRefresh) return;
    void this.options.onTokenRefresh().then((newToken) => {
      this.options.token = newToken;
      this.send('auth.refresh', { token: newToken });
    }).catch(() => {
      // Refresh failed — server will close the connection
    });
  }
}
