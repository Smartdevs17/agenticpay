import {
  NotificationChannel,
  Notification,
  NotificationDeliveryResult,
} from "../channel-interface";

export interface SlackChannelConfig {
  webhookUrl: string;
  botToken?: string;
  maxPerHour: number;
  maxPerDay: number;
}

export class SlackChannel implements NotificationChannel {
  readonly id = "slack";
  readonly name = "Slack";
  readonly enabled: boolean;
  readonly priority = 30;

  private config: SlackChannelConfig;

  constructor(config: SlackChannelConfig) {
    this.config = config;
    this.enabled = !!config.webhookUrl;
  }

  async send(notification: Notification): Promise<NotificationDeliveryResult> {
    const start = Date.now();

    try {
      const formatted = await this.format(notification);

      // Send to Slack webhook
      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formatted),
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.statusText}`);
      }

      return {
        success: true,
        channelId: this.id,
        messageId: `slack-${notification.id}`,
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
    const priorityEmoji = {
      low: ":white_circle:",
      normal: ":large_blue_circle:",
      high: ":large_orange_circle:",
      urgent: ":red_circle:",
    };

    return {
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: notification.title,
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${priorityEmoji[notification.priority]} *${notification.eventType}*\n\n${notification.body}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `<!date^${Math.floor(notification.createdAt.getTime() / 1000)}^{date_short_pretty} at {time}|${notification.createdAt.toISOString()}>`,
            },
          ],
        },
      ],
    };
  }

  async validate(): Promise<boolean> {
    return !!this.config.webhookUrl;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Health check" }),
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
