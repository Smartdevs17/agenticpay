import { WebSocketPool, type WebSocketPoolOptions } from './websocket/pool.js';

export type { WebSocketPoolOptions };

export type PoolState = {
  connected: boolean;
  reconnecting: boolean;
  lastError?: string;
  lastSequence?: number;
  droppedMessages?: number;
};

export interface WebSocketClientOptions extends WebSocketPoolOptions {
  /** Cap the maximum reconnect delay. Defaults to 5 minutes per acceptance criteria. */
  maxRetryCapMs?: number;
  /** Called when the server sends an auth.expired message. Return the new token string. */
  onTokenRefresh?: () => Promise<string>;
  /** If provided, the client will fall back to polling this endpoint when WS is unavailable. */
  pollingFallback?: {
    url: string;
    intervalMs: number;
  };
}

/**
 * Resilient WebSocket client adapter.
 *
 * Wraps WebSocketPool with the additional acceptance criteria from issue #477:
 * - Exponential backoff capped at maxRetryCapMs (default 5 min)
 * - Auth token refresh on auth.expired server messages
 * - Graceful degradation to HTTP polling when WebSocket is unavailable
 */
export class WebSocketClient {
  private readonly pool: WebSocketPool;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onTokenRefresh?: () => Promise<string>;
  private readonly pollingFallback?: WebSocketClientOptions['pollingFallback'];
  private messageListeners = new Set<(msg: string) => void>();

  constructor(private readonly options: WebSocketClientOptions) {
    const maxRetryCapMs = options.maxRetryCapMs ?? 5 * 60 * 1000;

    this.onTokenRefresh = options.onTokenRefresh;
    this.pollingFallback = options.pollingFallback;

    this.pool = new WebSocketPool({
      ...options,
      reconnect: {
        initialDelayMs: options.reconnect?.initialDelayMs ?? 250,
        maxDelayMs: Math.min(options.reconnect?.maxDelayMs ?? 10_000, maxRetryCapMs),
        jitterRatio: options.reconnect?.jitterRatio ?? 0.25,
      },
    });

    // Intercept auth.expired messages to trigger token refresh
    this.pool.onMessage((raw) => {
      this.handleIncomingMessage(raw);
    });
  }

  connect(): void {
    this.pool.connect();
  }

  destroy(): void {
    this.pool.destroy();
    if (this.pollingTimer !== null) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  onMessage(listener: (msg: string) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onState(listener: (state: PoolState) => void): () => void {
    return this.pool.onState(listener);
  }

  send(data: string, priority: 'high' | 'normal' = 'normal'): void {
    this.pool.send(data, priority);
  }

  subscribe(channels: string[]): void {
    this.pool.subscribe(channels);
  }

  unsubscribe(channels: string[]): void {
    this.pool.unsubscribe(channels);
  }

  /** Manually trigger auth token refresh and send the new token to the server. */
  handleAuthExpiry(): void {
    if (!this.onTokenRefresh) return;
    void this.onTokenRefresh().then((newToken) => {
      this.pool.send(JSON.stringify({ type: 'auth.refresh', token: newToken }), 'high');
    }).catch(() => {
      // Token refresh failed — connection will be closed by server on next ping
    });
  }

  /**
   * Start HTTP polling as a graceful fallback when WebSocket is unavailable.
   * Stops automatically when the WebSocket reconnects.
   */
  startPollingFallback(): void {
    if (!this.pollingFallback || this.pollingTimer !== null) return;

    this.pollingTimer = setInterval(async () => {
      try {
        const resp = await fetch(this.pollingFallback!.url);
        if (!resp.ok) return;
        const payload = await resp.text();
        for (const listener of this.messageListeners) listener(payload);
      } catch {
        // Network error — keep polling
      }
    }, this.pollingFallback.intervalMs);

    // Auto-stop polling once WS reconnects
    const unsub = this.pool.onState((state) => {
      if (state.connected && this.pollingTimer !== null) {
        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
        unsub();
      }
    });
  }

  private handleIncomingMessage(raw: string): void {
    // Check for auth.expired from server
    try {
      const parsed = JSON.parse(raw) as { type?: string };
      if (parsed.type === 'auth.expired') {
        this.handleAuthExpiry();
      }
    } catch {
      // Not JSON — pass through as-is
    }

    for (const listener of this.messageListeners) {
      listener(raw);
    }
  }
}
