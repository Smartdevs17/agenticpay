import {
  NotificationChannel,
  Notification,
  NotificationDeliveryResult,
} from "../channel-interface";

export interface PagerDutyChannelConfig {
  routingKey: string;
  apiUrl?: string;
  maxPerHour: number;
  maxPerDay: number;
}

const PRIORITY_TO_SEVERITY: Record<
  Notification["priority"],
  "info" | "warning" | "error" | "critical"
> = {
  low: "info",
  normal: "warning",
  high: "error",
  urgent: "critical",
};

export class PagerDutyChannel implements NotificationChannel {
  readonly id = "pagerduty";
  readonly name = "PagerDuty";
  readonly enabled: boolean;
  readonly priority = 10;

  private config: PagerDutyChannelConfig;
  private readonly apiUrl: string;

  constructor(config: PagerDutyChannelConfig) {
    this.config = config;
    this.enabled = !!config.routingKey;
    this.apiUrl = config.apiUrl || "https://events.pagerduty.com/v2/enqueue";
  }

  async send(notification: Notification): Promise<NotificationDeliveryResult> {
    const start = Date.now();

    try {
      const formatted = await this.format(notification);

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formatted),
      });

      if (!response.ok) {
        throw new Error(`PagerDuty Events API error: ${response.statusText}`);
      }

      const result = (await response.json()) as { dedup_key?: string };

      return {
        success: true,
        channelId: this.id,
        messageId: result.dedup_key || `pagerduty-${notification.id}`,
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
      routing_key: this.config.routingKey,
      event_action: "trigger",
      dedup_key: notification.id,
      payload: {
        summary: notification.title,
        source: "agenticpay",
        severity: PRIORITY_TO_SEVERITY[notification.priority],
        timestamp: notification.createdAt.toISOString(),
        custom_details: {
          eventType: notification.eventType,
          body: notification.body,
          userId: notification.userId,
          data: notification.data,
        },
      },
    };
  }

  async validate(): Promise<boolean> {
    return !!this.config.routingKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.routingKey) {
      return false;
    }

    try {
      // PagerDuty has no dedicated health endpoint; a well-formed request
      // with an invalid dedup_key still validates the routing key without
      // triggering a real incident.
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_key: this.config.routingKey,
          event_action: "trigger",
          dedup_key: "health-check",
          payload: {
            summary: "AgenticPay health check",
            source: "agenticpay",
            severity: "info",
          },
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a previously triggered incident by dedup key.
   */
  async resolve(dedupKey: string): Promise<boolean> {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_key: this.config.routingKey,
          event_action: "resolve",
          dedup_key: dedupKey,
        }),
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
