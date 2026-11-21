/**
 * Notification channel interface for plugin-based architecture
 */

export interface Notification {
  id: string;
  userId: string;
  eventType: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority: "low" | "normal" | "high" | "urgent";
  createdAt: Date;
}

export interface NotificationDeliveryResult {
  success: boolean;
  channelId: string;
  messageId?: string;
  error?: string;
  timestamp: Date;
  deliveryTimeMs: number;
}

export interface NotificationChannel {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number; // Lower number = higher priority in fallback chain

  /**
   * Send notification through this channel
   */
  send(notification: Notification): Promise<NotificationDeliveryResult>;

  /**
   * Format notification for this channel's requirements
   */
  format(notification: Notification): Promise<unknown>;

  /**
   * Validate channel configuration
   */
  validate(): Promise<boolean>;

  /**
   * Check if channel is healthy and can deliver messages
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get rate limit for this channel per user
   */
  getRateLimit(): { maxPerHour: number; maxPerDay: number };
}

export interface ChannelPlugin {
  create(config: Record<string, unknown>): NotificationChannel;
  metadata: {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
  };
}

export interface UserNotificationPreference {
  userId: string;
  eventType: string;
  channels: string[]; // Ordered by preference
  enabled: boolean;
  quietHoursStart?: number; // Hour 0-23
  quietHoursEnd?: number; // Hour 0-23
}
