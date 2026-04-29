import webpush from 'web-push';
const { setVapidDetails } = webpush;
import { config } from '../config.js';
import { generateVapidKeys, VapidKeys } from './vapid.js';

interface PushSubscription {
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
  enabled: boolean;
  payments: boolean;
  invoices: boolean;
  marketing: boolean;
  security: boolean;
  sound: string;
  badge: string;
}

interface StoredSubscription {
  userId: string;
  subscriptions: PushSubscription[];
  updatedAt: string;
}

interface StoredPreferences {
  userId: string;
  enabled: boolean;
  payments: boolean;
  invoices: boolean;
  marketing: boolean;
  security: boolean;
  sound: string;
  badge: string;
  updatedAt: string;
}

class PushService {
  private vapidKeys: VapidKeys | null = null;
  private subscriptions: Map<string, PushSubscription[]> = new Map();
  private preferences: Map<string, NotificationPreferences> = new Map();

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

  async subscribe(userId: string, subscription: PushSubscription): Promise<{ success: boolean }> {
    const existingSubscriptions = this.subscriptions.get(userId) || [];
    const filtered = existingSubscriptions.filter(s => s.endpoint !== subscription.endpoint);
    filtered.push(subscription);
    this.subscriptions.set(userId, filtered);

    console.log(`[Push] User ${userId} subscribed`);
    return { success: true };
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    const existingSubscriptions = this.subscriptions.get(userId) || [];
    const filtered = existingSubscriptions.filter(s => s.endpoint !== endpoint);
    this.subscriptions.set(userId, filtered);

    console.log(`[Push] User ${userId} unsubscribed from ${endpoint}`);
  }

  async sendNotification(params: {
    userId: string;
    title: string;
    body?: string;
    icon?: string;
    badge?: string;
    data?: Record<string, unknown>;
    actions?: Array<{ action: string; title: string; icon?: string }>;
  }): Promise<{ sent: number; failed: number }> {
    const { userId, title, body, icon, badge, data, actions } = params;
    const subscriptions = this.subscriptions.get(userId) || [];

    const preferences = await this.getPreferences(userId);
    if (!preferences.enabled) {
      return { sent: 0, failed: 0 };
    }

    const isPaymentNotification = data?.type === 'payment';
    const isInvoiceNotification = data?.type === 'invoice';
    const isMarketingNotification = data?.type === 'marketing';
    const isSecurityNotification = data?.type === 'security';

    if (isPaymentNotification && !preferences.payments) return { sent: 0, failed: 0 };
    if (isInvoiceNotification && !preferences.invoices) return { sent: 0, failed: 0 };
    if (isMarketingNotification && !preferences.marketing) return { sent: 0, failed: 0 };
    if (isSecurityNotification && !preferences.security) return { sent: 0, failed: 0 };

    const payload: PushNotificationPayload = {
      title,
      body,
      icon: icon || '/icons/notification.png',
      badge: badge || '/icons/badge.png',
      data,
      actions,
      silent: preferences.sound === 'none',
    };

    let sent = 0;
    let failed = 0;

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        sent++;
      } catch (error) {
        console.error(`[Push] Failed to send to ${subscription.endpoint}:`, error);
        failed++;
        
        if ((error as { statusCode?: number }).statusCode === 410) {
          await this.unsubscribe(userId, subscription.endpoint);
        }
      }
    }

    return { sent, failed };
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const stored = this.preferences.get(userId);
    if (stored) return stored;
    
    return {
      enabled: true,
      payments: true,
      invoices: true,
      marketing: false,
      security: true,
      sound: 'default',
      badge: 'default',
    };
  }

  async updatePreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    const current = await this.getPreferences(userId);
    const updated = { ...current, ...preferences };
    this.preferences.set(userId, updated);

    console.log(`[Push] Preferences updated for user ${userId}`);
    return updated;
  }
}

export const pushService = new PushService();