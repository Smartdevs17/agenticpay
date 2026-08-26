import {
  NotificationChannel,
  Notification,
  NotificationDeliveryResult,
} from "../channel-interface";

export interface WebhookChannelConfig {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
  maxPerHour: number;
  maxPerDay: number;
  timeout: number;
}

export class WebhookChannel implements NotificationChannel {
  readonly id = "webhook";
  readonly name = "Webhook";
  readonly enabled: boolean;
  readonly priority = 40;

  private config: WebhookChannelConfig;

  constructor(config: WebhookChannelConfig) {
    this.config = config;
    this.enabled = !!config.url;
  }

  async send(notification: Notification): Promise<NotificationDeliveryResult> {
    const start = Date.now();

    try {
      const formatted = await this.format(notification);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...this.config.headers,
      };

      if (this.config.secret) {
        headers["X-Webhook-Signature"] = this.generateSignature(
          JSON.stringify(formatted),
        );
      }

      const response = await fetch(this.config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(formatted),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.statusText}`);
      }

      return {
        success: true,
        channelId: this.id,
        messageId: `webhook-${notification.id}`,
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
      event: "notification",
      notification: {
        id: notification.id,
        userId: notification.userId,
        eventType: notification.eventType,
        title: notification.title,
        body: notification.body,
        priority: notification.priority,
        data: notification.data,
        createdAt: notification.createdAt.toISOString(),
      },
    };
  }

  private generateSignature(payload: string): string {
    if (!this.config.secret) return "";

    // HMAC SHA256 signature
    const crypto = require("crypto");
    const hmac = crypto.createHmac("sha256", this.config.secret);
    hmac.update(payload);
    return `sha256=${hmac.digest("hex")}`;
  }

  async validate(): Promise<boolean> {
    return !!this.config.url;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(this.config.url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getRateLimit() {
    return {
      maxPerHour: this.config.maxPerHour,
      maxPerDay: this.config.maxPerDay,
    };
  }
}
