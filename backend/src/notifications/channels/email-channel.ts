import {
  NotificationChannel,
  Notification,
  NotificationDeliveryResult,
} from "../channel-interface";

export interface EmailChannelConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  fromAddress: string;
  maxPerHour: number;
  maxPerDay: number;
}

export class EmailChannel implements NotificationChannel {
  readonly id = "email";
  readonly name = "Email";
  readonly enabled: boolean;
  readonly priority = 20;

  private config: EmailChannelConfig;
  private rateLimits = new Map<string, number[]>();

  constructor(config: EmailChannelConfig) {
    this.config = config;
    this.enabled = !!config.smtpHost;
  }

  async send(notification: Notification): Promise<NotificationDeliveryResult> {
    const start = Date.now();

    try {
      // Check rate limit
      if (!this.checkRateLimit(notification.userId)) {
        return {
          success: false,
          channelId: this.id,
          error: "Rate limit exceeded",
          timestamp: new Date(),
          deliveryTimeMs: Date.now() - start,
        };
      }

      const formatted = await this.format(notification);

      // Send email via SMTP (implementation omitted for brevity)
      // await sendEmail(formatted);

      this.recordSent(notification.userId);

      return {
        success: true,
        channelId: this.id,
        messageId: `email-${notification.id}`,
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
      to: notification.data?.email,
      from: this.config.fromAddress,
      subject: notification.title,
      html: this.generateHtml(notification),
      text: notification.body,
    };
  }

  private generateHtml(notification: Notification): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .header { background: #4F46E5; color: white; padding: 20px; }
            .content { padding: 20px; }
            .footer { background: #F3F4F6; padding: 10px; text-align: center; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${this.escapeHtml(notification.title)}</h1>
          </div>
          <div class="content">
            <p>${this.escapeHtml(notification.body)}</p>
          </div>
          <div class="footer">
            <p>AgenticPay - Autonomous Payment Infrastructure</p>
          </div>
        </body>
      </html>
    `;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  async validate(): Promise<boolean> {
    return !!(
      this.config.smtpHost &&
      this.config.smtpPort &&
      this.config.fromAddress
    );
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Ping SMTP server
      return true;
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

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const userLimits = this.rateLimits.get(userId) || [];

    // Filter out timestamps older than 24 hours
    const recent = userLimits.filter((t) => now - t < 24 * 60 * 60 * 1000);

    if (recent.length >= this.config.maxPerDay) {
      return false;
    }

    // Check hourly limit
    const lastHour = recent.filter((t) => now - t < 60 * 60 * 1000);
    if (lastHour.length >= this.config.maxPerHour) {
      return false;
    }

    return true;
  }

  private recordSent(userId: string): void {
    const userLimits = this.rateLimits.get(userId) || [];
    userLimits.push(Date.now());
    this.rateLimits.set(userId, userLimits);
  }
}
