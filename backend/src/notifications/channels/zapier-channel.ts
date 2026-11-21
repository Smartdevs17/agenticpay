import { createHmac } from 'node:crypto';
import {
  NotificationChannel,
  Notification,
  NotificationDeliveryResult,
} from '../channel-interface.js';

export interface ZapierChannelConfig {
  webhookUrl: string;
  secret?: string;
  headers?: Record<string, string>;
  maxPerHour?: number;
  maxPerDay?: number;
  timeout?: number;
}

export class ZapierChannel implements NotificationChannel {
  readonly id = 'zapier';
  readonly name = 'Zapier';
  readonly enabled: boolean;
  readonly priority = 45;

  private config: ZapierChannelConfig;

  constructor(config: ZapierChannelConfig) {
    this.config = {
      maxPerHour: config.maxPerHour ?? 100,
      maxPerDay: config.maxPerDay ?? 1000,
      timeout: config.timeout ?? 10000,
      ...config,
    };
    this.enabled = !!config.webhookUrl;
  }

  async send(notification: Notification): Promise<NotificationDeliveryResult> {
    const start = Date.now();

    try {
      const formatted = await this.format(notification);
      const rawPayload = JSON.stringify(formatted);
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'AgenticPay-Notification/1.0',
        'X-Zapier-Notification-Id': notification.id,
        'X-Zapier-Timestamp': timestamp,
        ...this.config.headers,
      };

      if (this.config.secret) {
        headers['X-Zapier-Signature'] = this.generateSignature(
          rawPayload,
          timestamp,
          this.config.secret
        );
      }

      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers,
        body: rawPayload,
        signal: AbortSignal.timeout(this.config.timeout ?? 10000),
      });

      if (!response.ok) {
        throw new Error(`Zapier webhook responded with status ${response.status}: ${response.statusText}`);
      }

      return {
        success: true,
        channelId: this.id,
        messageId: `zapier-${notification.id}`,
        timestamp: new Date(),
        deliveryTimeMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        channelId: this.id,
        error: error instanceof Error ? error.message : 'Unknown error delivering to Zapier',
        timestamp: new Date(),
        deliveryTimeMs: Date.now() - start,
      };
    }
  }

  async format(notification: Notification): Promise<unknown> {
    return {
      event: 'agenticpay.notification',
      notification: {
        id: notification.id,
        userId: notification.userId,
        eventType: notification.eventType,
        title: notification.title,
        body: notification.body,
        priority: notification.priority,
        data: notification.data ?? {},
        createdAt: notification.createdAt.toISOString(),
      },
      source: 'agenticpay',
      deliveredAt: new Date().toISOString(),
    };
  }

  private generateSignature(payload: string, timestamp: string, secret: string): string {
    const signaturePayload = `${timestamp}.${payload}`;
    const hmac = createHmac('sha256', secret);
    hmac.update(signaturePayload);
    return `sha256=${hmac.digest('hex')}`;
  }

  async validate(): Promise<boolean> {
    return !!this.config.webhookUrl;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.webhookUrl) return false;
    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getRateLimit() {
    return {
      maxPerHour: this.config.maxPerHour ?? 100,
      maxPerDay: this.config.maxPerDay ?? 1000,
    };
  }
}
