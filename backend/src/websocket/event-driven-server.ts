/**
 * #722: Event-Driven WebSocket Server Architecture
 * 
 * Refactors WebSocket server to use event-driven patterns for better
 * decoupling, scalability, and maintainability.
 */

import { EventEmitter } from 'events';
import type WebSocket from 'ws';
import { attachWebSocketServer, type AgenticPayWebSocketServer } from './server.js';
import type http from 'node:http';
import type { WebSocketOutboundMessage, WebSocketChannel } from './types.js';

// Event types for the WebSocket system
export enum WebSocketEvent {
  CONNECTION_OPENED = 'connection:opened',
  CONNECTION_CLOSED = 'connection:closed',
  CONNECTION_ERROR = 'connection:error',
  MESSAGE_RECEIVED = 'message:received',
  MESSAGE_SENT = 'message:sent',
  CHANNEL_SUBSCRIBED = 'channel:subscribed',
  CHANNEL_UNSUBSCRIBED = 'channel:unsubscribed',
  AUTH_EXPIRED = 'auth:expired',
  AUTH_REFRESHED = 'auth:refreshed',
  BROADCAST = 'broadcast',
  RATE_LIMIT_EXCEEDED = 'rateLimit:exceeded',
}

export interface ConnectionEvent {
  connectionId: string;
  clientInfo: {
    ip?: string;
    userAgent?: string;
  };
  timestamp: number;
}

export interface MessageEvent extends ConnectionEvent {
  message: any;
  channel?: WebSocketChannel;
}

export interface ChannelEvent extends ConnectionEvent {
  channel: WebSocketChannel;
}

export interface BroadcastEvent {
  message: WebSocketOutboundMessage;
  targetChannel?: WebSocketChannel;
  excludeConnections?: string[];
}

/**
 * Event-driven WebSocket server wrapper
 * Provides event-based hooks for all WebSocket operations
 */
export class EventDrivenWebSocketServer extends EventEmitter {
  private wsServer: AgenticPayWebSocketServer;
  private connectionRegistry = new Map<string, ConnectionEvent>();

  constructor(params: {
    server: http.Server;
    options?: any;
    scaling?: any;
  }) {
    super();
    this.wsServer = attachWebSocketServer(params);
    this.setupEventHandlers();
  }

  /**
   * Setup internal event handlers to emit domain events
   */
  private setupEventHandlers(): void {
    // Intercept the original broadcast to emit events
    const originalBroadcast = this.wsServer.broadcast.bind(this.wsServer);
    this.wsServer.broadcast = (message: WebSocketOutboundMessage) => {
      this.emit(WebSocketEvent.BROADCAST, {
        message,
        targetChannel: message.channel,
      } as BroadcastEvent);
      
      this.emit(WebSocketEvent.MESSAGE_SENT, {
        message,
        timestamp: Date.now(),
      });
      
      originalBroadcast(message);
    };
  }

  /**
   * Register connection with event emission
   */
  registerConnection(connectionId: string, clientInfo: { ip?: string; userAgent?: string }): void {
    const event: ConnectionEvent = {
      connectionId,
      clientInfo,
      timestamp: Date.now(),
    };
    
    this.connectionRegistry.set(connectionId, event);
    this.emit(WebSocketEvent.CONNECTION_OPENED, event);
  }

  /**
   * Unregister connection with event emission
   */
  unregisterConnection(connectionId: string): void {
    const event = this.connectionRegistry.get(connectionId);
    if (event) {
      this.connectionRegistry.delete(connectionId);
      this.emit(WebSocketEvent.CONNECTION_CLOSED, event);
    }
  }

  /**
   * Emit message received event
   */
  onMessageReceived(connectionId: string, message: any, channel?: WebSocketChannel): void {
    const connectionEvent = this.connectionRegistry.get(connectionId);
    if (connectionEvent) {
      this.emit(WebSocketEvent.MESSAGE_RECEIVED, {
        ...connectionEvent,
        message,
        channel,
      } as MessageEvent);
    }
  }

  /**
   * Emit channel subscription event
   */
  onChannelSubscribed(connectionId: string, channel: WebSocketChannel): void {
    const connectionEvent = this.connectionRegistry.get(connectionId);
    if (connectionEvent) {
      this.emit(WebSocketEvent.CHANNEL_SUBSCRIBED, {
        ...connectionEvent,
        channel,
      } as ChannelEvent);
    }
  }

  /**
   * Emit channel unsubscription event
   */
  onChannelUnsubscribed(connectionId: string, channel: WebSocketChannel): void {
    const connectionEvent = this.connectionRegistry.get(connectionId);
    if (connectionEvent) {
      this.emit(WebSocketEvent.CHANNEL_UNSUBSCRIBED, {
        ...connectionEvent,
        channel,
      } as ChannelEvent);
    }
  }

  /**
   * Emit auth expired event
   */
  onAuthExpired(connectionId: string): void {
    const connectionEvent = this.connectionRegistry.get(connectionId);
    if (connectionEvent) {
      this.emit(WebSocketEvent.AUTH_EXPIRED, connectionEvent);
    }
  }

  /**
   * Emit auth refreshed event
   */
  onAuthRefreshed(connectionId: string): void {
    const connectionEvent = this.connectionRegistry.get(connectionId);
    if (connectionEvent) {
      this.emit(WebSocketEvent.AUTH_REFRESHED, connectionEvent);
    }
  }

  /**
   * Get metrics
   */
  get metrics() {
    return this.wsServer.metrics;
  }

  /**
   * Broadcast message (event-driven)
   */
  broadcast(message: WebSocketOutboundMessage): void {
    this.wsServer.broadcast(message);
  }

  /**
   * Broadcast to channel (event-driven)
   */
  broadcastToChannel(channel: WebSocketChannel, message: Omit<WebSocketOutboundMessage, 'channel'>): void {
    this.wsServer.broadcastToChannel(channel, message);
  }

  /**
   * Close server
   */
  async close(): Promise<void> {
    await this.wsServer.close();
    this.removeAllListeners();
  }

  /**
   * Get active connections count
   */
  get activeConnections(): number {
    return this.connectionRegistry.size;
  }
}

/**
 * Example usage and event handlers
 */
export function setupWebSocketEventHandlers(wsServer: EventDrivenWebSocketServer): void {
  // Log connections
  wsServer.on(WebSocketEvent.CONNECTION_OPENED, (event: ConnectionEvent) => {
    console.log(`[WS] Connection opened: ${event.connectionId} from ${event.clientInfo.ip}`);
  });

  wsServer.on(WebSocketEvent.CONNECTION_CLOSED, (event: ConnectionEvent) => {
    console.log(`[WS] Connection closed: ${event.connectionId}`);
  });

  // Analytics on messages
  wsServer.on(WebSocketEvent.MESSAGE_RECEIVED, (event: MessageEvent) => {
    // Track message patterns, user behavior, etc.
    console.log(`[WS] Message from ${event.connectionId}:`, event.message);
  });

  // Monitor channel subscriptions
  wsServer.on(WebSocketEvent.CHANNEL_SUBSCRIBED, (event: ChannelEvent) => {
    console.log(`[WS] ${event.connectionId} subscribed to ${event.channel}`);
  });

  // Security monitoring
  wsServer.on(WebSocketEvent.AUTH_EXPIRED, (event: ConnectionEvent) => {
    console.warn(`[WS] Auth expired for ${event.connectionId}`);
  });

  // Broadcast analytics
  wsServer.on(WebSocketEvent.BROADCAST, (event: BroadcastEvent) => {
    console.log(`[WS] Broadcasting to channel ${event.targetChannel || 'all'}`);
  });
}
