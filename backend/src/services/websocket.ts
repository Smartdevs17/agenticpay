import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { pushService } from './push.js';
import { prisma } from '../db.js';
import { NotificationCategory } from '@prisma/client';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  tenantId?: string;
}

class WebSocketService {
  private io: SocketIOServer | null = null;
  private userConnections: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds

  /**
   * Initialize WebSocket server
   */
  initialize(httpServer: HTTPServer): SocketIOServer {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.CORS_ALLOWED_ORIGINS?.split(',') || '*',
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    this.setupMiddleware();
    this.setupEventHandlers();

    console.log('[WebSocket] Initialized');
    return this.io;
  }

  /**
   * Setup WebSocket middleware for authentication
   */
  private setupMiddleware(): void {
    if (!this.io) return;

    this.io.use((socket: AuthenticatedSocket, next) => {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Authentication error'));
      }

      try {
        // TODO: Validate JWT token here
        // For now, extract userId from token or query params
        const userId = socket.handshake.auth.userId || socket.handshake.query.userId;
        const tenantId = socket.handshake.auth.tenantId || socket.handshake.query.tenantId;

        if (!userId || !tenantId) {
          return next(new Error('Missing userId or tenantId'));
        }

        socket.userId = String(userId);
        socket.tenantId = String(tenantId);
        socket.join(`user:${userId}`);
        socket.join(`tenant:${tenantId}`);

        console.log(`[WebSocket] User ${userId} connected`);
        next();
      } catch (error) {
        console.error('[WebSocket] Auth error:', error);
        next(new Error('Authentication failed'));
      }
    });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    if (!this.io) return;

    this.io.on('connection', (socket: AuthenticatedSocket) => {
      if (!socket.userId) {
        socket.disconnect();
        return;
      }

      // Track user connections
      if (!this.userConnections.has(socket.userId)) {
        this.userConnections.set(socket.userId, new Set());
      }
      this.userConnections.get(socket.userId)!.add(socket.id);

      // Handle push subscription events
      socket.on('notification:subscribe', (data, callback) => {
        this.handleNotificationSubscribe(socket, data, callback);
      });

      socket.on('notification:unsubscribe', (data, callback) => {
        this.handleNotificationUnsubscribe(socket, data, callback);
      });

      socket.on('notification:preferences', (data, callback) => {
        this.handleGetPreferences(socket, data, callback);
      });

      socket.on('notification:updatePreferences', (data, callback) => {
        this.handleUpdatePreferences(socket, data, callback);
      });

      socket.on('notification:markAsRead', (data, callback) => {
        this.handleMarkAsRead(socket, data, callback);
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      socket.on('error', (error) => {
        console.error(`[WebSocket] Socket error for user ${socket.userId}:`, error);
      });
    });
  }

  /**
   * Handle notification subscription
   */
  private async handleNotificationSubscribe(
    socket: AuthenticatedSocket,
    data: any,
    callback: Function
  ): Promise<void> {
    try {
      if (!socket.userId || !socket.tenantId) {
        callback({ error: 'Unauthorized' });
        return;
      }

      const { subscription } = data;

      const result = await pushService.subscribe(
        socket.tenantId,
        socket.userId,
        subscription,
        socket.handshake.headers['user-agent']
      );

      callback({ success: true, subscriptionId: result.subscriptionId });
    } catch (error) {
      console.error('[WebSocket] Subscribe error:', error);
      callback({ error: error instanceof Error ? error.message : 'Failed to subscribe' });
    }
  }

  /**
   * Handle notification unsubscription
   */
  private async handleNotificationUnsubscribe(
    socket: AuthenticatedSocket,
    data: any,
    callback: Function
  ): Promise<void> {
    try {
      if (!socket.userId || !socket.tenantId) {
        callback({ error: 'Unauthorized' });
        return;
      }

      const { endpoint } = data;

      await pushService.unsubscribe(socket.tenantId, socket.userId, endpoint);

      callback({ success: true });
    } catch (error) {
      console.error('[WebSocket] Unsubscribe error:', error);
      callback({ error: error instanceof Error ? error.message : 'Failed to unsubscribe' });
    }
  }

  /**
   * Handle get preferences
   */
  private async handleGetPreferences(
    socket: AuthenticatedSocket,
    _data: any,
    callback: Function
  ): Promise<void> {
    try {
      if (!socket.userId || !socket.tenantId) {
        callback({ error: 'Unauthorized' });
        return;
      }

      const preferences = await pushService.getPreferences(socket.tenantId, socket.userId);

      callback({ success: true, preferences });
    } catch (error) {
      console.error('[WebSocket] Get preferences error:', error);
      callback({ error: error instanceof Error ? error.message : 'Failed to get preferences' });
    }
  }

  /**
   * Handle update preferences
   */
  private async handleUpdatePreferences(
    socket: AuthenticatedSocket,
    data: any,
    callback: Function
  ): Promise<void> {
    try {
      if (!socket.userId || !socket.tenantId) {
        callback({ error: 'Unauthorized' });
        return;
      }

      const preferences = await pushService.updatePreferences(
        socket.tenantId,
        socket.userId,
        data
      );

      callback({ success: true, preferences });
    } catch (error) {
      console.error('[WebSocket] Update preferences error:', error);
      callback({ error: error instanceof Error ? error.message : 'Failed to update preferences' });
    }
  }

  /**
   * Handle mark as read
   */
  private async handleMarkAsRead(
    socket: AuthenticatedSocket,
    data: any,
    callback: Function
  ): Promise<void> {
    try {
      if (!socket.userId || !socket.tenantId) {
        callback({ error: 'Unauthorized' });
        return;
      }

      const { notificationId } = data;

      await pushService.markNotificationAsClicked(socket.tenantId, notificationId);

      callback({ success: true });
    } catch (error) {
      console.error('[WebSocket] Mark as read error:', error);
      callback({ error: error instanceof Error ? error.message : 'Failed to mark as read' });
    }
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(socket: AuthenticatedSocket): void {
    if (socket.userId) {
      const connections = this.userConnections.get(socket.userId);
      if (connections) {
        connections.delete(socket.id);
        if (connections.size === 0) {
          this.userConnections.delete(socket.userId);
        }
      }

      console.log(`[WebSocket] User ${socket.userId} disconnected`);
    }
  }

  /**
   * Send real-time notification to user
   */
  async sendRealtimeNotification(
    tenantId: string,
    userId: string,
    notification: {
      id: string;
      title: string;
      body: string;
      category: NotificationCategory;
      icon?: string;
      badge?: string;
      data?: Record<string, any>;
      deepLink?: string;
    }
  ): Promise<void> {
    if (!this.io) {
      console.warn('[WebSocket] Not initialized');
      return;
    }

    const room = `user:${userId}`;

    this.io.to(room).emit('notification:new', {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      category: notification.category,
      icon: notification.icon,
      badge: notification.badge,
      data: notification.data,
      deepLink: notification.deepLink,
      timestamp: new Date().toISOString(),
    });

    console.log(`[WebSocket] Sent notification to ${room}`);
  }

  /**
   * Send batch notifications
   */
  async sendBatchNotifications(
    tenantId: string,
    userIds: string[],
    notification: {
      title: string;
      body: string;
      category: NotificationCategory;
      icon?: string;
      badge?: string;
      data?: Record<string, any>;
    }
  ): Promise<void> {
    if (!this.io) {
      console.warn('[WebSocket] Not initialized');
      return;
    }

    for (const userId of userIds) {
      const notificationLog = await prisma.notificationLog.create({
        data: {
          tenantId,
          userId,
          category: notification.category,
          status: 'pending',
          title: notification.title,
          body: notification.body,
          icon: notification.icon,
          badge: notification.badge,
          data: notification.data,
        },
      });

      this.io.to(`user:${userId}`).emit('notification:new', {
        id: notificationLog.id,
        title: notification.title,
        body: notification.body,
        category: notification.category,
        icon: notification.icon,
        badge: notification.badge,
        data: notification.data,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[WebSocket] Sent batch notification to ${userIds.length} users`);
  }

  /**
   * Get connected user count
   */
  getConnectedUserCount(): number {
    return this.userConnections.size;
  }

  /**
   * Get connections for a user
   */
  getUserConnections(userId: string): number {
    return this.userConnections.get(userId)?.size || 0;
  }
}

export const webSocketService = new WebSocketService();
