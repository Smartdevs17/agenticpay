import type { LogEntry, LogFilter, LogLevel, LogViewerState } from './types.js';

const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];
const LEVEL_COLORS: Record<LogLevel, string> = {
  error: '#ef4444',
  warn: '#f59e0b',
  info: '#3b82f6',
  debug: '#6b7280',
  trace: '#9ca3af',
};

type Listener = () => void;

export class LogViewerClient {
  private ws: WebSocket | null = null;
  private state: LogViewerState;
  private listeners = new Set<Listener>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private url: string;

  constructor(url = 'ws://localhost:3001/ws/logs') {
    this.url = url;
    this.state = {
      entries: [],
      filter: { levels: [...LOG_LEVELS], search: '' },
      paused: false,
      expandedEntry: null,
    };
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string);

        if (message.type === 'log:entry') {
          if (!this.state.paused) {
            this.state.entries = [...this.state.entries, message.payload].slice(-5000);
            this.notify();
          }
        } else if (message.type === 'log:buffer') {
          this.state.entries = [...(message.payload as LogEntry[])];
          this.notify();
        } else if (message.type === 'log:cleared') {
          this.state.entries = [];
          this.notify();
        }
      } catch {
        // Ignore parse errors
      }
    };

    this.ws.onclose = () => {
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect(): void {
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnect
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    setTimeout(() => this.connect(), delay);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): LogViewerState {
    return this.state;
  }

  setFilter(filter: Partial<LogFilter>): void {
    this.state.filter = { ...this.state.filter, ...filter };
    this.notify();
  }

  setPaused(paused: boolean): void {
    this.state.paused = paused;
    this.notify();
  }

  toggleExpand(index: number): void {
    this.state.expandedEntry = this.state.expandedEntry === index ? null : index;
    this.notify();
  }

  clearLogs(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'log:clear' }));
    }
    this.state.entries = [];
    this.notify();
  }

  getFilteredEntries(): LogEntry[] {
    const { filter, entries } = this.state;
    return entries.filter((entry) => {
      if (!filter.levels.includes(entry.level)) return false;
      if (filter.search) {
        const search = filter.search.toLowerCase();
        const inMsg = entry.msg?.toLowerCase().includes(search);
        const inModule = entry.module?.toLowerCase().includes(search);
        const inService = entry.service?.toLowerCase().includes(search);
        const inTrace = entry.traceId?.toLowerCase().includes(search);
        if (!inMsg && !inModule && !inService && !inTrace) return false;
      }
      if (filter.service && entry.service !== filter.service) return false;
      if (filter.module && entry.module !== filter.module) return false;
      if (filter.timeRange) {
        const t = new Date(entry.timestamp).getTime();
        if (filter.timeRange.start && t < new Date(filter.timeRange.start).getTime()) return false;
        if (filter.timeRange.end && t > new Date(filter.timeRange.end).getTime()) return false;
      }
      return true;
    });
  }

  getLevelColor(level: LogLevel): string {
    return LEVEL_COLORS[level] || '#6b7280';
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getStats(): { total: number; filtered: number; connected: boolean } {
    return {
      total: this.state.entries.length,
      filtered: this.getFilteredEntries().length,
      connected: this.isConnected(),
    };
  }
}
