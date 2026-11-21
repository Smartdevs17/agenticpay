import { WebSocketServer, WebSocket } from 'ws';
import type http from 'node:http';
import { createModuleLogger } from '../middleware/logger.js';

const log = createModuleLogger('dev-transport');

export interface LogEntry {
  level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  timestamp: string;
  msg: string;
  module?: string;
  service?: string;
  traceId?: string;
  requestId?: string;
  correlationId?: string;
  stack?: string;
  [key: string]: unknown;
}

const MAX_LOG_BUFFER = 5000;
const logBuffer: LogEntry[] = [];

let wss: WebSocketServer | null = null;
let connections = new Set<WebSocket>();

export function createDevLogTransport(server: http.Server, path = '/ws/logs'): void {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname !== path) return;
      wss!.handleUpgrade(req, socket, head, (ws) => {
        wss!.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    connections.add(ws);

    // Send buffered logs on connect
    if (logBuffer.length > 0) {
      ws.send(JSON.stringify({ type: 'log:buffer', payload: logBuffer.slice(-200) }));
    }

    ws.on('close', () => {
      connections.delete(ws);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'log:clear') {
          logBuffer.length = 0;
          broadcast({ type: 'log:cleared' });
        } else if (msg.type === 'log:set-level') {
          log.info(`Log level filter changed to: ${msg.payload?.level}`);
        }
      } catch {
        // Ignore invalid messages
      }
    });
  });

  log.info(`Dev log WebSocket transport listening on ${path}`);
}

export function pushLog(entry: LogEntry): void {
  // Add to ring buffer
  if (logBuffer.length >= MAX_LOG_BUFFER) {
    logBuffer.shift();
  }
  logBuffer.push(entry);

  // Broadcast to connected clients
  broadcast({ type: 'log:entry', payload: entry });
}

function broadcast(message: unknown): void {
  const data = JSON.stringify(message);
  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

export function getLogBuffer(): LogEntry[] {
  return [...logBuffer];
}

export function clearLogBuffer(): void {
  logBuffer.length = 0;
}

export function getDevLogStats(): { connections: number; bufferSize: number } {
  return {
    connections: connections.size,
    bufferSize: logBuffer.length,
  };
}

/**
 * Creates a pino transport-compatible write function.
 * Use this as the `target` option for pino's transport pipeline in dev mode.
 *
 * Usage in logger config:
 *   transport: {
 *     target: './logger/dev-transport.js',
 *     options: { level: 'debug' }
 *   }
 */
export function pinoDevTransport(): { write: (data: string) => void } {
  return {
    write(data: string) {
      try {
        const parsed = JSON.parse(data) as LogEntry;
        pushLog(parsed);
      } catch {
        // Ignore parse errors
      }
    },
  };
}
