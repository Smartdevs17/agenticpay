import webpush from 'web-push';
const { setVapidDetails } = webpush;
import { config } from '../config.js';
import { generateVapidKeys, VapidKeys } from './vapid.js';
import { prisma } from '../db.js';
import { NotificationCategory } from '@prisma/client';

interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushNotificationPayload {
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
  tag?: string;
  requireInteraction?: boolean;
  silent?: boolean;
  vibrate?: number[];
}

interface NotificationPreferences {
  paymentNotifications: boolean;
  disputeAlerts: boolean;
  projectUpdates: boolean;
  milestoneReminders: boolean;
  securityAlerts: boolean;
  subscriptionUpdates: boolean;
  systemNotifications: boolean;
  groupNotifications: boolean;
  notifySound: boolean;
  notifyBadge: boolean;
  locale: string;
  timezone: string;
}

class PushService {
  private vapidKeys: VapidKeys | null = null;

  constructor() {
    this.initializeVapidKeys();
  }

  private initializeVapidKeys(): void {
    try {
      const storedKeys = config.vapidKeys;
      if (storedKeys && storedKeys.publicKey && storedKeys.privateKey) {
        this.vapidKeys = storedKeys as VapidKeys;
      } else {
        this.vapidKeys = generateVapidKeys();
      }
      
      setVapidDetails(
        'mailto:security@agenticpay.com',
        this.vapidKeys.publicKey,
        this.vapidKeys.privateKey
      );
      
      console.log('[Push] VAPID keys initialized');
    } catch (error) {
      console.error('[Push] Failed to initialize VAPID keys:', error);
      this.vapidKeys = generateVapidKeys();
    }
  }

  getVapidPublicKey(): string {
    return this.vapidKeys?.publicKey || '';
  }

  async subscribe(
    tenantId: string,
    userId: string,
    subscription: PushSubscriptionInput,
    userAgent?: string
  ): Promise<{ success: boolean; subscriptionId: string }> {
    try {
      // Check if subscription already exists
      const existing = await prisma.pushSubscription.findFirst({
        where: {
          tenantId,
          userId,
          endpoint: subscription.endpoint,
        },
      });

      let subscriptionId: string;

      if (existing) {
        // Update existing subscription
        await prisma.pushSubscription.update({
          where: { id: existing.id },
          data: {
            auth: subscription.keys.auth,
            p256dh: subscription.keys.p256dh,
            userAgent: userAgent || existing.userAgent,
            isActive: true,
            lastUsedAt: new Date(),
          },
        });
        subscriptionId = existing.id;
      } else {
        // Create new subscription
        const newSubscription = await prisma.pushSubscription.create({
          data: {
            tenantId,
            userId,
            endpoint: subscription.endpoint,
            auth: subscription.keys.auth,
            p256dh: subscription.keys.p256dh,
            userAgent,
            isActive: true,
          },
        });
        subscriptionId = newSubscription.id;
      }

      console.log(`[Push] User ${userId} subscribed (ID: ${subscriptionId})`);
      return { success: true, subscriptionId };
    } catch (error) {
      console.error('[Push] Failed to subscribe:', error);
      throw error;
    }
  }

  async unsubscribe(tenantId: string, userId: string, endpoint: string): Promise<void> {
    try {
      await prisma.pushSubscription.updateMany({
        where: {
          tenantId,
          userId,
          endpoint,
        },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
      });

      console.log(`[Push] User ${userId} unsubscribed from ${endpoint}`);
    } catch (error) {
      console.error('[Push] Failed to unsubscribe:', error);
      throw error;
    }
  }

  async sendNotification(params: {
    tenantId: string;
    userId: string;
    category: NotificationCategory;
    title: string;
    body?: string;
    icon?: string;
    badge?: string;
    data?: Record<string, unknown>;
    tag?: string;
    deepLink?: string;
    actions?: Array<{ action: string; title: string; icon?: string }>;
  }): Promise<{ sent: number; failed: number; notificationLogId: string }> {
    const {
      tenantId,
      userId,
      category,
      title,
      body,
      icon,
      badge,
      data,
      tag,
      deepLink,
      actions,
    } = params;

    try {
      // Check preferences
      const preferences = await this.getPreferences(tenantId, userId);
      
      // Check if this category is enabled
      const categoryPreferenceMap: Record<NotificationCategory, keyof NotificationPreferences> = {
        payment_notification: 'paymentNotifications',
        dispute_alert: 'disputeAlerts',
        project_update: 'projectUpdates',
        milestone_reminder: 'milestoneReminders',
        security_alert: 'securityAlerts',
        subscription_update: 'subscriptionUpdates',
        system_notification: 'systemNotifications',
      };

      if (categoryPreferenceMap[category] && !preferences[categoryPreferenceMap[category]]) {
        // Create notification log with skipped status
        const log = await prisma.notificationLog.create({
          data: {
            tenantId,
            userId,
            category,
            status: 'pending',
            title,
            body: body || '',
            icon,
            badge,
            tag,
            data,
            deepLink,
          },
        });
        return { sent: 0, failed: 0, notificationLogId: log.id };
      }

      // Get active subscriptions
      const subscriptions = await prisma.pushSubscription.findMany({
        where: {
          tenantId,
          userId,
          isActive: true,
          deletedAt: null,
        },
      });

      const payload: PushNotificationPayload = {
        title,
        body,
        icon: icon || '/icons/notification.png',
        badge: badge || '/icons/badge.png',
        data: {
          ...data,
          deepLink,
          category,
        },
        actions,
        tag,
        silent: !preferences.notifySound,
        requireInteraction: category === 'dispute_alert' || category === 'security_alert',
      };

      let sent = 0;
      let failed = 0;

      // Create notification log
      const notificationLog = await prisma.notificationLog.create({
        data: {
          tenantId,
          userId,
          category,
          status: 'pending',
          title,
          body: body || '',
          icon,
          badge,
          tag,
          data,
          deepLink,
        },
      });

      for (const subscription of subscriptions) {
        try {
          await webpush.sendNotification(subscription, JSON.stringify(payload));
          
          // Update subscription last used time
          await prisma.pushSubscription.update({
            where: { id: subscription.id },
            data: { lastUsedAt: new Date() },
          });

          // Update notification log
          await prisma.notificationLog.update({
            where: { id: notificationLog.id },
            data: {
              subscriptionId: subscription.id,
              status: 'sent',
              sentAt: new Date(),
            },
          });

          sent++;
        } catch (error) {
          console.error(`[Push] Failed to send to ${subscription.endpoint}:`, error);
          failed++;

          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 410 || statusCode === 404) {
            // Subscription is no longer valid
            await this.unsubscribe(tenantId, userId, subscription.endpoint);
          }

          // Log error
          await prisma.notificationLog.update({
            where: { id: notificationLog.id },
            data: {
              subscriptionId: subscription.id,
              status: 'failed',
              error: String(error),
              retryCount: 1,
            },
          });
        }
      }

      // Update final notification log status
      if (sent > 0) {
        await prisma.notificationLog.update({
          where: { id: notificationLog.id },
          data: {
            status: 'delivered',
            deliveredAt: new Date(),
          },
        });
      }

      return { sent, failed, notificationLogId: notificationLog.id };
    } catch (error) {
      console.error('[Push] Failed to send notification:', error);
      throw error;
    }
  }

  async getPreferences(
    tenantId: string,
    userId: string
  ): Promise<NotificationPreferences> {
    try {
      let preferences = await prisma.pushPreference.findUnique({
        where: {
          tenantId_userId: { tenantId, userId },
        },
      });

      if (!preferences) {
        // Create default preferences
        preferences = await prisma.pushPreference.create({
          data: {
            tenantId,
            userId,
          },
        });
      }

      return {
        paymentNotifications: preferences.paymentNotifications,
        disputeAlerts: preferences.disputeAlerts,
        projectUpdates: preferences.projectUpdates,
        milestoneReminders: preferences.milestoneReminders,
        securityAlerts: preferences.securityAlerts,
        subscriptionUpdates: preferences.subscriptionUpdates,
        systemNotifications: preferences.systemNotifications,
        groupNotifications: preferences.groupNotifications,
        notifySound: preferences.notifySound,
        notifyBadge: preferences.notifyBadge,
        locale: preferences.locale,
        timezone: preferences.timezone,
      };
    } catch (error) {
      console.error('[Push] Failed to get preferences:', error);
      // Return defaults on error
      return {
        paymentNotifications: true,
        disputeAlerts: true,
        projectUpdates: true,
        milestoneReminders: true,
        securityAlerts: true,
        subscriptionUpdates: true,
        systemNotifications: true,
        groupNotifications: true,
        notifySound: true,
        notifyBadge: true,
        locale: 'en',
        timezone: 'UTC',
      };
    }
  }

  async updatePreferences(
    tenantId: string,
    userId: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    try {
      let existing = await prisma.pushPreference.findUnique({
        where: {
          tenantId_userId: { tenantId, userId },
        },
      });

      if (!existing) {
        existing = await prisma.pushPreference.create({
          data: {
            tenantId,
            userId,
            ...preferences,
          },
        });
      } else {
        existing = await prisma.pushPreference.update({
          where: {
            tenantId_userId: { tenantId, userId },
          },
          data: preferences,
        });
      }

      console.log(`[Push] Preferences updated for user ${userId}`);

      return {
        paymentNotifications: existing.paymentNotifications,
        disputeAlerts: existing.disputeAlerts,
        projectUpdates: existing.projectUpdates,
        milestoneReminders: existing.milestoneReminders,
        securityAlerts: existing.securityAlerts,
        subscriptionUpdates: existing.subscriptionUpdates,
        systemNotifications: existing.systemNotifications,
        groupNotifications: existing.groupNotifications,
        notifySound: existing.notifySound,
        notifyBadge: existing.notifyBadge,
        locale: existing.locale,
        timezone: existing.timezone,
      };
    } catch (error) {
      console.error('[Push] Failed to update preferences:', error);
      throw error;
    }
  }

  async getNotificationHistory(
    tenantId: string,
    userId: string,
    limit: number = 50
  ): Promise<any[]> {
    try {
      return await prisma.notificationLog.findMany({
        where: {
          tenantId,
          userId,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      console.error('[Push] Failed to get notification history:', error);
      throw error;
    }
  }

  async markNotificationAsClicked(
    tenantId: string,
    notificationLogId: string
  ): Promise<void> {
    try {
      await prisma.notificationLog.update({
        where: { id: notificationLogId },
        data: {
          status: 'clicked',
          clickedAt: new Date(),
        },
      });

      console.log(`[Push] Notification ${notificationLogId} marked as clicked`);
    } catch (error) {
      console.error('[Push] Failed to mark notification as clicked:', error);
      throw error;
    }
  }
}

export const pushService = new PushService();