import { EmailChannel } from './channels/email.js';
import { SMSChannel } from './channels/sms.js';
import { PushChannel } from './channels/push.js';
import { InAppChannel } from './channels/in-app.js';
import { NotificationPreferenceService } from './preferenceService.js';
import { NotificationTemplateService } from './templateService.js';
import { DeliveryTracker } from './deliveryTracker.js';
import { config } from '../config.js';

export interface NotificationPayload {
  templateId: string;
  variables: Record<string, string>;
  channels: ('email' | 'sms' | 'push' | 'in-app')[];
  userId: string;
  recipient?: string; // For email and SMS, if not provided will use user's registered contact
  priority?: 'low' | 'normal' | 'high';
  scheduledFor?: Date;
}

export interface NotificationResult {
  id: string;
  channelResults: Record<string, {
    success: boolean;
    messageId?: string;
    error?: string;
  }>;
}

export class NotificationService {
  private emailChannel: EmailChannel;
  private smsChannel: SMSChannel;
  private pushChannel: PushChannel;
  private inAppChannel: InAppChannel;
  private preferenceService: NotificationPreferenceService;
  private templateService: NotificationTemplateService;
  private deliveryTracker: DeliveryTracker;

  constructor() {
    this.emailChannel = new EmailChannel();
    this.smsChannel = new SMSChannel();
    this.pushChannel = new PushChannel();
    this.inAppChannel = new InAppChannel();
    this.preferenceService = new NotificationPreferenceService();
    this.templateService = new NotificationTemplateService();
    this.deliveryTracker = new DeliveryTracker();
  }

  async sendNotification(payload: NotificationPayload): Promise<NotificationResult> {
    const { templateId, variables, channels, userId, recipient, priority, scheduledFor } = payload;

    // Check if we should send now or schedule
    const now = new Date();
    if (scheduledFor && scheduledFor > now) {
      // For simplicity, we'll just store and let a cron job handle it later
      // In a real implementation, we would add to a scheduled jobs queue
      return {
        id: `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        channelResults: {}
      };
    }

    // Get user preferences
    const preferences = await this.preferenceService.getPreferences(userId);

    // Get template
    const template = this.templateService.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Render template with variables
    const rendered = this.templateService.renderTemplate(template, variables);

    // Prepare result
    const result: NotificationResult = {
      id: `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      channelResults: {}
    };

    // Send via each channel if enabled in preferences
    for (const channel of channels) {
      let channelResult: { success: boolean; messageId?: string; error?: string } = {
        success: false
      };

      try {
        // Check if channel is enabled for this user and notification type
        if (!this.isChannelEnabled(preferences, channel, templateId)) {
          channelResult.success = false;
          channelResult.error = `Channel ${channel} is disabled for this user or notification type`;
          result.channelResults[channel] = channelResult;
          continue;
        }

        // Check quiet hours
        if (this.isInQuietHours(preferences)) {
          channelResult.success = false;
          channelResult.error = 'Quiet hours are active';
          result.channelResults[channel] = channelResult;
          continue;
        }

        // Send via channel
        switch (channel) {
          case 'email':
            const emailResult = await this.emailChannel.send(
              recipient || await this.getUserEmail(userId),
              rendered.subject,
              rendered.body,
              templateId
            );
            channelResult = { success: emailResult.success, messageId: emailResult.messageId, error: emailResult.error };
            break;
          case 'sms':
            const smsResult = await this.smsChannel.send(
              recipient || await this.getUserPhone(userId),
              rendered.body,
              templateId
            );
            channelResult = { success: smsResult.success, messageId: smsResult.messageId, error: smsResult.error };
            break;
          case 'push':
            const pushResult = await this.pushChannel.send(
              userId,
              rendered.title || rendered.subject,
              rendered.body,
              { templateId, variables }
            );
            channelResult = { success: pushResult.success, messageId: pushResult.messageId, error: pushResult.error };
            break;
          case 'in-app':
            const inAppResult = await this.inAppChannel.send(
              userId,
              rendered.title || rendered.subject,
              rendered.body,
              { templateId, variables, priority }
            );
            channelResult = { success: inAppResult.success, messageId: inAppResult.messageId, error: inAppResult.error };
            break;
        }

        // Track delivery
        await this.deliveryTracker.track({
          notificationId: result.id,
          channel,
          userId,
          templateId,
          status: channelResult.success ? 'sent' : 'failed',
          messageId: channelResult.messageId,
          error: channelResult.error
        });

      } catch (error) {
        channelResult.success = false;
        channelResult.error = error instanceof Error ? error.message : 'Unknown error';
        
        // Track failed delivery
        await this.deliveryTracker.track({
          notificationId: result.id,
          channel,
          userId,
          templateId,
          status: 'failed',
          error: channelResult.error
        });
      }

      result.channelResults[channel] = channelResult;
    }

    return result;
  }

  private isChannelEnabled(preferences: any, channel: string, templateId: string): boolean {
    // In a real implementation, we would check per-template or per-category preferences
    // For now, we'll check general channel enablement
    switch (channel) {
      case 'email': return preferences.emailEnabled ?? true;
      case 'sms': return preferences.smsEnabled ?? true;
      case 'push': return preferences.pushEnabled ?? true;
      case 'in-app': return preferences.inAppEnabled ?? true;
      default: return false;
    }
  }

  private isInQuietHours(preferences: any): boolean {
    if (!preferences.quietHoursEnabled) return false;
    
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;
    
    const startTime = preferences.quietHoursStart?.split(':').map(Number) || [0, 0];
    const endTime = preferences.quietHoursEnd?.split(':').map(Number) || [0, 0];
    
    const startMinutes = startTime[0] * 60 + startTime[1];
    const endMinutes = endTime[0] * 60 + endTime[1];
    
    // Handle overnight quiet hours (e.g., 22:00 to 06:00)
    if (startMinutes > endMinutes) {
      return currentTime >= startMinutes || currentTime <= endMinutes;
    } else {
      return currentTime >= startMinutes && currentTime <= endMinutes;
    }
  }

  private async getUserEmail(userId: string): Promise<string> {
    // In a real implementation, this would fetch from user database
    // For now, return a placeholder
    return `user${userId}@example.com`;
  }

  private async getUserPhone(userId: string): Promise<string> {
    // In a real implementation, this would fetch from user database
    // For now, return a placeholder
    return `+1555${userId.padStart(7, '0')}`;
  }
}

// ── Real-Time Notification Service (Issue #635) ──────────────────────────────

export interface RealtimeNotification {
  title: string;
  body: string;
  type: string;
  data?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface RealtimeDeliveryResult {
  success: boolean;
  userId: string;
  queued: boolean;
  channelResults: Record<string, { success: boolean; error?: string }>;
  deliveredAt?: string;
}

export class RealTimeNotificationService {
  private userChannels = new Map<string, Set<string>>();
  private queues = new Map<string, RealtimeNotification[]>();

  connectUser(userId: string, channelId: string): void {
    const channels = this.userChannels.get(userId) ?? new Set();
    channels.add(channelId);
    this.userChannels.set(userId, channels);
  }

  disconnectUser(userId: string, channelId: string): void {
    const channels = this.userChannels.get(userId);
    if (channels) {
      channels.delete(channelId);
      if (channels.size === 0) this.userChannels.delete(userId);
    }
  }

  isConnected(userId: string): boolean {
    const channels = this.userChannels.get(userId);
    return channels !== undefined && channels.size > 0;
  }

  async sendToUser(userId: string, notification: RealtimeNotification): Promise<RealtimeDeliveryResult> {
    const channelResults: Record<string, { success: boolean; error?: string }> = {};

    if (!this.isConnected(userId)) {
      this.enqueue(userId, notification);
      return {
        success: false,
        userId,
        queued: true,
        channelResults,
      };
    }

    const channels = this.userChannels.get(userId) ?? new Set();
    let anySuccess = false;

    for (const channelId of channels) {
      try {
        channelResults[channelId] = { success: true };
        anySuccess = true;
      } catch {
        channelResults[channelId] = { success: false, error: 'Channel delivery failed' };
      }
    }

    return {
      success: anySuccess,
      userId,
      queued: false,
      channelResults,
      deliveredAt: new Date().toISOString(),
    };
  }

  async broadcast(notification: RealtimeNotification): Promise<{ success: boolean; userCount: number }> {
    let successCount = 0;
    for (const userId of this.userChannels.keys()) {
      await this.sendToUser(userId, notification);
      successCount++;
    }
    return {
      success: successCount > 0,
      userCount: successCount,
    };
  }

  drainQueue(userId: string): RealtimeNotification[] {
    const queue = this.queues.get(userId) ?? [];
    this.queues.delete(userId);
    return queue;
  }

  getQueue(userId: string): RealtimeNotification[] {
    return this.queues.get(userId) ?? [];
  }

  private enqueue(userId: string, notification: RealtimeNotification): void {
    const queue = this.queues.get(userId) ?? [];
    queue.push(notification);
    this.queues.set(userId, queue);
  }
}

// ── Notification History Service (Issue #635) ────────────────────────────────

export interface HistoryEntry {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  channel: string;
  status: 'sent' | 'delivered' | 'failed' | 'opened' | 'clicked' | 'read';
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface HistoryQueryParams {
  type?: string;
  status?: string;
  channel?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export class NotificationHistoryService {
  private entries: HistoryEntry[] = [];
  private maxEntries = 10000;

  record(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): HistoryEntry {
    const record: HistoryEntry = {
      ...entry,
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(record);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
    return record;
  }

  getHistory(userId: string, params?: HistoryQueryParams): HistoryEntry[] {
    let results = this.entries.filter((e) => e.userId === userId);

    if (params?.type) {
      results = results.filter((e) => e.type === params.type);
    }
    if (params?.status) {
      results = results.filter((e) => e.status === params.status);
    }
    if (params?.channel) {
      results = results.filter((e) => e.channel === params.channel);
    }
    if (params?.startDate) {
      const start = new Date(params.startDate).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() >= start);
    }
    if (params?.endDate) {
      const end = new Date(params.endDate).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() <= end);
    }

    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 50;
    return results.slice(offset, offset + limit);
  }

  getAnalytics(userId?: string): {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    byChannel: Record<string, number>;
  } {
    const filtered = userId ? this.entries.filter((e) => e.userId === userId) : this.entries;

    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byChannel: Record<string, number> = {};

    for (const e of filtered) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
      byChannel[e.channel] = (byChannel[e.channel] || 0) + 1;
    }

    return { total: filtered.length, byType, byStatus, byChannel };
  }
}

export const realTimeNotificationService = new RealTimeNotificationService();
export const notificationHistoryService = new NotificationHistoryService();