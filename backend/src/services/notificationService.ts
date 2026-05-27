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