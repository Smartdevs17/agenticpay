import {
  NotificationChannel,
  Notification,
  NotificationDeliveryResult,
} from "../channel-interface";

export class InAppChannel implements NotificationChannel {
  readonly id = "in-app";
  readonly name = "In-App";
  readonly enabled = true;
  readonly priority = 10; // Highest priority

  async send(notification: Notification): Promise<NotificationDeliveryResult> {
    const start = Date.now();

    try {
      // Store in database for in-app display
      // await db.notification.create({ data: notification });

      // Emit WebSocket event for real-time delivery
      // await websocket.emit(`user:${notification.userId}:notification`, notification);

      return {
        success: true,
        channelId: this.id,
        messageId: `in-app-${notification.id}`,
        timestamp: new Date(),
        deliveryTimeMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        channelId: this.id,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
        deliveryTimeMs: Date.now() - start,
      };
    }
  }

  async format(notification: Notification): Promise<unknown> {
    return {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      type: notification.eventType,
      priority: notification.priority,
      data: notification.data,
      createdAt: notification.createdAt,
      read: false,
    };
  }

  async validate(): Promise<boolean> {
    return true;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  getRateLimit() {
    return {
      maxPerHour: 100,
      maxPerDay: 500,
    };
  }
}
