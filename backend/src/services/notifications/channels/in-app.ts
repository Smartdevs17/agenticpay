import { config } from '../../../config.js';

export interface InAppSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class InAppChannel {
  // In a real implementation, this would store notifications in a database
  // For now, we'll use an in-memory store
  private notifications: Array<{
    id: string;
    userId: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    read: boolean;
    createdAt: Date;
  }> = [];

  async send(userId: string, title: string, body: string, data?: Record<string, unknown>): Promise<InAppSendResult> {
    try {
      // Store the in-app notification
      const notification = {
        id: `inapp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        title,
        body,
        data: data || {},
        read: false,
        createdAt: new Date()
      };

      this.notifications.push(notification);

      // In a real implementation, we might also emit a real-time event via WebSocket
      // to notify the frontend immediately

      console.log(`[In-App] Stored notification for user ${userId}: ${title}`);

      return {
        success: true,
        messageId: notification.id
      };
    } catch (error) {
      console.error('[In-App] Failed to store notification:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Method to get notifications for a user (would be used by frontend API)
  getNotificationsForUser(userId: string, limit = 50, offset = 0) {
    const userNotifications = this.notifications
      .filter(n => n.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);

    return {
      notifications: userNotifications,
      total: this.notifications.filter(n => n.userId === userId).length
    };
  }

  // Method to mark notification as read
  markAsRead(notificationId: string, userId: string): boolean {
    const index = this.notifications.findIndex(
      n => n.id === notificationId && n.userId === userId
    );

    if (index !== -1) {
      this.notifications[index].read = true;
      return true;
    }

    return false;
  }
}