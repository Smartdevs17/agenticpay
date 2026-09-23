import {
  NotificationChannel,
  Notification,
  NotificationDeliveryResult,
} from "../channel-interface";

export interface DatadogChannelConfig {
  apiKey: string;
  site?: string; // e.g. "datadoghq.com", "datadoghq.eu"
  service?: string;
  maxPerHour: number;
  maxPerDay: number;
}

const PRIORITY_TO_ALERT_TYPE: Record<
  Notification["priority"],
  "info" | "warning" | "error" | "success"
> = {
  low: "info",
  normal: "info",
  high: "warning",
  urgent: "error",
};

export class DatadogChannel implements NotificationChannel {
  readonly id = "datadog";
  readonly name = "Datadog";
  readonly enabled: boolean;
  readonly priority = 20;

  private config: DatadogChannelConfig;
  private readonly baseUrl: string;

  constructor(config: DatadogChannelConfig) {
    this.config = config;
    this.enabled = !!config.apiKey;
    this.baseUrl = `https://api.${config.site || "datadoghq.com"}`;
  }

  async send(notification: Notification): Promise<NotificationDeliveryResult> {
    const start = Date.now();

    try {
      const formatted = await this.format(notification);

      const response = await fetch(`${this.baseUrl}/api/v1/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "DD-API-KEY": this.config.apiKey,
        },
        body: JSON.stringify(formatted),
      });

      if (!response.ok) {
        throw new Error(`Datadog Events API error: ${response.statusText}`);
      }

      const result = (await response.json()) as { event?: { id?: number } };

      return {
        success: true,
        channelId: this.id,
        messageId: result.event?.id
          ? String(result.event.id)
          : `datadog-${notification.id}`,
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
      title: notification.title,
      text: notification.body,
      alert_type: PRIORITY_TO_ALERT_TYPE[notification.priority],
      source_type_name: "agenticpay",
      date_happened: Math.floor(notification.createdAt.getTime() / 1000),
      tags: [
        `event_type:${notification.eventType}`,
        `priority:${notification.priority}`,
        `user_id:${notification.userId}`,
        `service:${this.config.service || "agenticpay"}`,
      ],
    };
  }

  /**
   * Emit a raw metric to Datadog, independent of the notification pipeline.
   */
  async submitMetric(
    metric: string,
    value: number,
    tags: string[] = [],
  ): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v2/series`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "DD-API-KEY": this.config.apiKey,
        },
        body: JSON.stringify({
          series: [
            {
              metric,
              type: 3, // gauge
              points: [{ timestamp: Math.floor(Date.now() / 1000), value }],
              tags: [`service:${this.config.service || "agenticpay"}`, ...tags],
            },
          ],
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async validate(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.apiKey) {
      return false;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/validate`,
        {
          method: "GET",
          headers: { "DD-API-KEY": this.config.apiKey },
        },
      );
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
