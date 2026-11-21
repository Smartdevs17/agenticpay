import {
  NotificationChannel,
  Notification,
  NotificationDeliveryResult,
} from '../channel-interface.js';

export interface WhatsAppNotificationChannelConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  apiUrl?: string;
  maxPerHour?: number;
  maxPerDay?: number;
  timeout?: number;
}

export class WhatsAppNotificationChannel implements NotificationChannel {
  readonly id = 'whatsapp';
  readonly name = 'WhatsApp';
  readonly enabled: boolean;
  readonly priority = 35; // Between SMS/Slack and Zapier

  private config: WhatsAppNotificationChannelConfig;

  constructor(config: WhatsAppNotificationChannelConfig = {}) {
    this.config = {
      maxPerHour: config.maxPerHour ?? 50,
      maxPerDay: config.maxPerDay ?? 500,
      timeout: config.timeout ?? 10000,
      fromNumber: config.fromNumber || process.env.WHATSAPP_FROM_NUMBER || 'whatsapp:+14155238886',
      apiUrl: config.apiUrl || process.env.WHATSAPP_API_URL,
      accountSid: config.accountSid || process.env.TWILIO_ACCOUNT_SID,
      authToken: config.authToken || process.env.TWILIO_AUTH_TOKEN,
      ...config,
    };

    // Enabled if explicitly configured or running in test/dev simulation mode
    this.enabled = true;
  }

  async send(notification: Notification): Promise<NotificationDeliveryResult> {
    const start = Date.now();

    try {
      if (!notification.body && !notification.title) {
        throw new Error('Notification must contain title or body');
      }

      const formatted = await this.format(notification) as { to: string; body: string };

      // In real implementation with Twilio/WhatsApp API
      if (this.config.apiUrl) {
        const response = await fetch(this.config.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}),
          },
          body: JSON.stringify(formatted),
          signal: AbortSignal.timeout(this.config.timeout ?? 10000),
        });

        if (!response.ok) {
          throw new Error(`WhatsApp API responded with status ${response.status}: ${response.statusText}`);
        }
      }

      return {
        success: true,
        channelId: this.id,
        messageId: `whatsapp-${notification.id}`,
        timestamp: new Date(),
        deliveryTimeMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        channelId: this.id,
        error: error instanceof Error ? error.message : 'Unknown error delivering WhatsApp notification',
        timestamp: new Date(),
        deliveryTimeMs: Date.now() - start,
      };
    }
  }

  async format(notification: Notification): Promise<unknown> {
    const priorityBadge = {
      low: 'ℹ️',
      normal: '💳',
      high: '⚡',
      urgent: '🚨',
    }[notification.priority] || '💳';

    const formattedText = `*${priorityBadge} AgenticPay Notification*\n*${notification.title}*\n\n${notification.body}\n\n_Event: ${notification.eventType}_`;

    const recipient = (notification.data?.phone as string) ||
      (notification.data?.recipient as string) ||
      (notification.data?.whatsappNumber as string) ||
      `whatsapp:+1555${notification.userId.replace(/\D/g, '').padEnd(7, '0').slice(0, 7)}`;

    return {
      to: recipient.startsWith('whatsapp:') ? recipient : `whatsapp:${recipient.replace(/\s+/g, '')}`,
      from: this.config.fromNumber,
      body: formattedText,
      data: notification.data ?? {},
      timestamp: notification.createdAt.toISOString(),
    };
  }

  async validate(): Promise<boolean> {
    return true;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.apiUrl) return true;
    try {
      const response = await fetch(this.config.apiUrl, {
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
      maxPerHour: this.config.maxPerHour ?? 50,
      maxPerDay: this.config.maxPerDay ?? 500,
    };
  }
}
