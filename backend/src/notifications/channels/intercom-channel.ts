import {
  NotificationChannel,
  Notification,
  NotificationDeliveryResult,
} from '../channel-interface.js';
import { IntercomClient } from '../../integrations/intercom/intercom-client.js';

export interface IntercomChannelConfig {
  accessToken: string;
  apiUrl?: string;
  appId?: string;
  adminId?: string;
  maxPerHour?: number;
  maxPerDay?: number;
  timeout?: number;
}

export class IntercomChannel implements NotificationChannel {
  readonly id = 'intercom';
  readonly name = 'Intercom';
  readonly enabled: boolean;
  readonly priority = 50;

  private config: IntercomChannelConfig;
  private client: IntercomClient;

  constructor(config: IntercomChannelConfig) {
    this.config = {
      maxPerHour: config.maxPerHour ?? 50,
      maxPerDay: config.maxPerDay ?? 500,
      timeout: config.timeout ?? 10000,
      ...config,
    };
    this.enabled = !!config.accessToken;
    this.client = new IntercomClient({
      accessToken: config.accessToken,
      apiUrl: config.apiUrl,
      appId: config.appId,
      adminId: config.adminId,
      timeoutMs: this.config.timeout,
    });
  }

  async send(notification: Notification): Promise<NotificationDeliveryResult> {
    const start = Date.now();

    try {
      const formatted = await this.format(notification);

      // Upsert contact so the message has an associated customer
      let contactId: string | undefined;
      try {
        const contact = await this.client.upsertContactByExternalId(notification.userId, {
          role: 'user',
          custom_attributes: {
            last_notification_type: notification.eventType,
            last_notification_at: Math.floor(Date.now() / 1000),
          },
        });
        contactId = contact.id;
      } catch {
        // If contact creation fails, fallback to passing external id
      }

      // Create Intercom conversation
      const conversation = await this.client.createConversation({
        from: {
          type: 'user',
          id: contactId,
        },
        body: `**${formatted.title}**\n\n${formatted.body}\n\n*Event: ${formatted.eventType} | Priority: ${formatted.priority.toUpperCase()}*`,
      });

      return {
        success: true,
        channelId: this.id,
        messageId: `intercom-${conversation.id}`,
        timestamp: new Date(),
        deliveryTimeMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        channelId: this.id,
        error: error instanceof Error ? error.message : 'Unknown error delivering to Intercom',
        timestamp: new Date(),
        deliveryTimeMs: Date.now() - start,
      };
    }
  }

  async format(notification: Notification): Promise<{
    title: string;
    body: string;
    eventType: string;
    priority: string;
    data: Record<string, unknown>;
  }> {
    return {
      title: notification.title,
      body: notification.body,
      eventType: notification.eventType,
      priority: notification.priority,
      data: notification.data ?? {},
    };
  }

  async validate(): Promise<boolean> {
    if (!this.enabled || !this.config.accessToken) {
      return false;
    }
    return true;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return this.client.testConnection();
  }

  getRateLimit(): { maxPerHour: number; maxPerDay: number } {
    return {
      maxPerHour: this.config.maxPerHour ?? 50,
      maxPerDay: this.config.maxPerDay ?? 500,
    };
  }
}
