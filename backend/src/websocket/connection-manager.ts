import type http from 'node:http';
import type { AgenticPayWebSocketServer } from './server.js';
import type { WebSocketServerMetrics } from './types.js';
import { createWsAuthHandler } from '../middleware/ws-auth.js';

export interface ConnectionManagerOptions {
  maxConnectionsPerIp?: number;
  maxConnectionsPerUser?: number;
  idleTimeoutMs?: number;
  requireAuth?: boolean;
  /** Trust X-Forwarded-For header for IP resolution. Only enable when sitting behind a known proxy. */
  trustProxy?: boolean;
}

export interface ConnectionManagerMetrics extends WebSocketServerMetrics {
  rejectedByIpLimit: number;
  rejectedByAuthFailure: number;
  idleDisconnections: number;
}

const DEFAULT_OPTIONS: Required<ConnectionManagerOptions> = {
  maxConnectionsPerIp: 10,
  maxConnectionsPerUser: 5,
  idleTimeoutMs: 5 * 60 * 1000,
  requireAuth: false,
  trustProxy: false,
};

export class ConnectionManager {
  private readonly options: Required<ConnectionManagerOptions>;
  private readonly ipCounts = new Map<string, number>();
  private readonly userCounts = new Map<string, number>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private extraMetrics: Pick<ConnectionManagerMetrics, 'rejectedByIpLimit' | 'rejectedByAuthFailure' | 'idleDisconnections'> = {
    rejectedByIpLimit: 0,
    rejectedByAuthFailure: 0,
    idleDisconnections: 0,
  };

  constructor(
    private readonly wsServer: AgenticPayWebSocketServer,
    options?: ConnectionManagerOptions,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  get resolvedOptions(): Required<ConnectionManagerOptions> {
    return this.options;
  }

  checkIpLimit(ip: string): boolean {
    return (this.ipCounts.get(ip) ?? 0) < this.options.maxConnectionsPerIp;
  }

  trackConnection(ip: string, userId?: string): void {
    this.ipCounts.set(ip, (this.ipCounts.get(ip) ?? 0) + 1);
    if (userId) this.userCounts.set(userId, (this.userCounts.get(userId) ?? 0) + 1);
  }

  releaseConnection(ip: string, userId?: string): void {
    const ipCount = Math.max(0, (this.ipCounts.get(ip) ?? 0) - 1);
    if (ipCount === 0) this.ipCounts.delete(ip);
    else this.ipCounts.set(ip, ipCount);

    if (userId) {
      const userCount = Math.max(0, (this.userCounts.get(userId) ?? 0) - 1);
      if (userCount === 0) this.userCounts.delete(userId);
      else this.userCounts.set(userId, userCount);
    }
  }

  resetIdleTimer(sessionId: string, onTimeout: () => void): void {
    const existing = this.idleTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.idleTimers.delete(sessionId);
      this.extraMetrics.idleDisconnections += 1;
      onTimeout();
    }, this.options.idleTimeoutMs);

    this.idleTimers.set(sessionId, timer);
  }

  clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (timer) { clearTimeout(timer); this.idleTimers.delete(sessionId); }
  }

  recordRejectedByIpLimit(): void {
    this.extraMetrics.rejectedByIpLimit += 1;
  }

  recordRejectedByAuth(): void {
    this.extraMetrics.rejectedByAuthFailure += 1;
  }

  getAggregatedMetrics(): ConnectionManagerMetrics {
    return { ...this.wsServer.metrics, ...this.extraMetrics };
  }
}

export function createConnectionManager(
  server: http.Server,
  wsServer: AgenticPayWebSocketServer,
  options?: ConnectionManagerOptions,
): ConnectionManager {
  const manager = new ConnectionManager(wsServer, options);
  const authHandler = createWsAuthHandler({ allowQueryParam: true });

  server.prependListener('upgrade', (req, socket) => {
    const peerAddress = (socket as unknown as { remoteAddress?: string }).remoteAddress ?? '0.0.0.0';
    const ip = manager.resolvedOptions.trustProxy
      ? ((req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? peerAddress)
      : peerAddress;

    // Auth check
    if (options?.requireAuth) {
      const authResult = authHandler(req);
      if (!authResult.valid) {
        manager.recordRejectedByAuth();
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    // IP connection rate limit
    if (!manager.checkIpLimit(ip)) {
      manager.recordRejectedByIpLimit();
      socket.write('HTTP/1.1 429 Too Many Connections\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nToo many WebSocket connections from this IP\r\n');
      socket.destroy();
      return;
    }

    manager.trackConnection(ip);
    socket.once('close', () => manager.releaseConnection(ip));
  });

  return manager;
}
