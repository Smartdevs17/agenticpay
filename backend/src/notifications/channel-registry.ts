/**
 * Notification channel registry for dynamic plugin discovery
 */

import { NotificationChannel, ChannelPlugin } from "./channel-interface";
import { EmailChannel } from "./channels/email-channel";
import { SlackChannel } from "./channels/slack-channel";
import { InAppChannel } from "./channels/in-app-channel";
import { WebhookChannel } from "./channels/webhook-channel";

export class ChannelRegistry {
  private channels = new Map<string, NotificationChannel>();
  private plugins = new Map<string, ChannelPlugin>();

  constructor() {
    this.loadBuiltInChannels();
  }

  /**
   * Load built-in notification channels
   */
  private loadBuiltInChannels() {
    // Email channel
    if (process.env.SMTP_HOST) {
      const emailChannel = new EmailChannel({
        smtpHost: process.env.SMTP_HOST,
        smtpPort: parseInt(process.env.SMTP_PORT || "587"),
        smtpUser: process.env.SMTP_USER || "",
        smtpPassword: process.env.SMTP_PASSWORD || "",
        fromAddress: process.env.SMTP_FROM || "noreply@agenticpay.com",
        maxPerHour: 10,
        maxPerDay: 50,
      });
      this.register(emailChannel);
    }

    // Slack channel
    if (process.env.SLACK_WEBHOOK_URL) {
      const slackChannel = new SlackChannel({
        webhookUrl: process.env.SLACK_WEBHOOK_URL,
        botToken: process.env.SLACK_BOT_TOKEN,
        maxPerHour: 20,
        maxPerDay: 100,
      });
      this.register(slackChannel);
    }

    // In-app channel (always enabled)
    const inAppChannel = new InAppChannel();
    this.register(inAppChannel);

    // Webhook channel
    if (process.env.NOTIFICATION_WEBHOOK_URL) {
      const webhookChannel = new WebhookChannel({
        url: process.env.NOTIFICATION_WEBHOOK_URL,
        secret: process.env.NOTIFICATION_WEBHOOK_SECRET,
        maxPerHour: 50,
        maxPerDay: 500,
        timeout: 10000,
      });
      this.register(webhookChannel);
    }
  }

  /**
   * Register a notification channel
   */
  register(channel: NotificationChannel): void {
    if (this.channels.has(channel.id)) {
      console.warn(`Channel ${channel.id} already registered, replacing`);
    }
    this.channels.set(channel.id, channel);
    console.log(
      `Registered notification channel: ${channel.name} (${channel.id})`,
    );
  }

  /**
   * Register a channel plugin
   */
  registerPlugin(plugin: ChannelPlugin, config: Record<string, unknown>): void {
    this.plugins.set(plugin.metadata.id, plugin);
    const channel = plugin.create(config);
    this.register(channel);
  }

  /**
   * Get a channel by ID
   */
  get(channelId: string): NotificationChannel | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Get all registered channels
   */
  getAll(): NotificationChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get enabled channels sorted by priority
   */
  getEnabled(): NotificationChannel[] {
    return Array.from(this.channels.values())
      .filter((channel) => channel.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Check if a channel exists and is enabled
   */
  isEnabled(channelId: string): boolean {
    const channel = this.channels.get(channelId);
    return channel?.enabled ?? false;
  }

  /**
   * Remove a channel from the registry
   */
  unregister(channelId: string): boolean {
    return this.channels.delete(channelId);
  }

  /**
   * Validate all registered channels
   */
  async validateAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [id, channel] of this.channels.entries()) {
      try {
        const isValid = await channel.validate();
        results.set(id, isValid);
      } catch (error) {
        console.error(`Validation failed for channel ${id}:`, error);
        results.set(id, false);
      }
    }

    return results;
  }

  /**
   * Health check all enabled channels
   */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const channel of this.getEnabled()) {
      try {
        const isHealthy = await channel.healthCheck();
        results.set(channel.id, isHealthy);
        if (!isHealthy) {
          console.warn(`Channel ${channel.id} failed health check`);
        }
      } catch (error) {
        console.error(`Health check failed for channel ${channel.id}:`, error);
        results.set(channel.id, false);
      }
    }

    return results;
  }

  /**
   * Get channels for a specific event type based on user preferences
   */
  getChannelsForEvent(
    eventType: string,
    userChannels?: string[],
  ): NotificationChannel[] {
    if (userChannels && userChannels.length > 0) {
      // Use user-specified channels in order
      return userChannels
        .map((id) => this.channels.get(id))
        .filter(
          (channel): channel is NotificationChannel =>
            channel !== undefined && channel.enabled,
        );
    }

    // Default: all enabled channels sorted by priority
    return this.getEnabled();
  }
}

export const channelRegistry = new ChannelRegistry();
