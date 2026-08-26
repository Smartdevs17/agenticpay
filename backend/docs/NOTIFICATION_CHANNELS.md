# Notification Channel Plugin System

## Overview

The notification system uses a channel-based plugin architecture that allows dynamic addition of new notification channels without modifying core code.

## Built-in Channels

- **In-App**: Real-time notifications via WebSocket (highest priority)
- **Email**: SMTP-based email notifications
- **Slack**: Slack webhook notifications with rich formatting
- **Webhook**: Generic webhook for custom integrations

## Creating a Custom Channel

Implement the `NotificationChannel` interface:

```typescript
import {
  NotificationChannel,
  Notification,
  NotificationDeliveryResult,
} from "./channel-interface";

export class CustomChannel implements NotificationChannel {
  readonly id = "custom";
  readonly name = "Custom Channel";
  readonly enabled = true;
  readonly priority = 50;

  async send(notification: Notification): Promise<NotificationDeliveryResult> {
    // Send notification
  }

  async format(notification: Notification): Promise<unknown> {
    // Format for channel
  }

  async validate(): Promise<boolean> {
    // Validate configuration
  }

  async healthCheck(): Promise<boolean> {
    // Check channel health
  }

  getRateLimit() {
    return { maxPerHour: 10, maxPerDay: 50 };
  }
}
```

## Registration

```typescript
import { channelRegistry } from "./channel-registry";
import { CustomChannel } from "./channels/custom-channel";

const customChannel = new CustomChannel(config);
channelRegistry.register(customChannel);
```

## User Preferences

Users can configure:

- Preferred channels per event type
- Channel priority/fallback order
- Quiet hours (no notifications during specified times)

## Fallback Chain

If the primary channel fails, the system automatically tries fallback channels in priority order.

## Rate Limiting

Each channel enforces its own rate limits to prevent spam.

## Environment Variables

```
# Email Channel
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASSWORD=password
SMTP_FROM=noreply@agenticpay.com

# Slack Channel
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
SLACK_BOT_TOKEN=xoxb-your-token

# Webhook Channel
NOTIFICATION_WEBHOOK_URL=https://your-webhook-endpoint.com/notify
NOTIFICATION_WEBHOOK_SECRET=your-webhook-secret
```
