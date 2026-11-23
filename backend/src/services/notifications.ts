/**
 * Multi-channel notification system with per-user preference matrix — Issue #1352
 *
 * Preference matrix = channel × category. A notification is delivered on a
 * channel only when both the channel is enabled and the (channel, category)
 * cell is true. Quiet hours suppress non-security categories.
 */

import { logger } from '../utils/logger.js';
import {
  notificationPreferenceService,
  type NotificationPreferences,
} from './notifications/preferenceService.js';

export type NotificationChannel = 'email' | 'sms' | 'push' | 'inApp' | 'whatsapp';
export type NotificationCategory =
  | 'payments'
  | 'invoices'
  | 'marketing'
  | 'security'
  | 'productUpdates';

export const NOTIFICATION_CHANNELS: NotificationChannel[] = [
  'email',
  'sms',
  'push',
  'inApp',
  'whatsapp',
];

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'payments',
  'invoices',
  'marketing',
  'security',
  'productUpdates',
];

/** channel → category → enabled */
export type PreferenceMatrix = Record<
  NotificationChannel,
  Record<NotificationCategory, boolean>
>;

export type NotificationPayload = {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  /** Force delivery even during quiet hours (defaults true for security). */
  bypassQuietHours?: boolean;
};

export type ChannelDeliveryResult = {
  channel: NotificationChannel;
  delivered: boolean;
  reason?: string;
};

export type DispatchResult = {
  notificationId: string;
  userId: string;
  category: NotificationCategory;
  results: ChannelDeliveryResult[];
  deliveredChannels: NotificationChannel[];
};

const CHANNEL_ENABLED_KEY: Record<NotificationChannel, keyof NotificationPreferences> = {
  email: 'emailEnabled',
  sms: 'smsEnabled',
  push: 'pushEnabled',
  inApp: 'inAppEnabled',
  whatsapp: 'whatsappEnabled',
};

function defaultMatrixCell(
  prefs: NotificationPreferences,
  channel: NotificationChannel,
  category: NotificationCategory
): boolean {
  const channelOn = Boolean(prefs[CHANNEL_ENABLED_KEY[channel]]);
  const categoryOn = Boolean(prefs[category]);
  return channelOn && categoryOn;
}

/**
 * Build the full preference matrix for a user from stored preferences,
 * overlaying any explicit matrix cells the user has set.
 */
export function buildPreferenceMatrix(
  prefs: NotificationPreferences,
  overrides?: Partial<PreferenceMatrix>
): PreferenceMatrix {
  const matrix = {} as PreferenceMatrix;
  for (const channel of NOTIFICATION_CHANNELS) {
    matrix[channel] = {} as Record<NotificationCategory, boolean>;
    for (const category of NOTIFICATION_CATEGORIES) {
      const override = overrides?.[channel]?.[category];
      matrix[channel][category] =
        typeof override === 'boolean'
          ? override
          : defaultMatrixCell(prefs, channel, category);
    }
  }
  return matrix;
}

function parseHm(value: string): number {
  const [h, m] = value.split(':').map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function isWithinQuietHours(
  prefs: NotificationPreferences,
  now: Date = new Date()
): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = parseHm(prefs.quietHoursStart);
  const end = parseHm(prefs.quietHoursEnd);
  if (start === end) return false;
  // Window that wraps midnight (e.g. 22:00–06:00)
  if (start > end) return minutes >= start || minutes < end;
  return minutes >= start && minutes < end;
}

export class MultiChannelNotificationService {
  private matrices = new Map<string, PreferenceMatrix>();
  private deliveries: DispatchResult[] = [];

  async getMatrix(userId: string): Promise<PreferenceMatrix> {
    const prefs = await notificationPreferenceService.getPreferences(userId);
    const stored = this.matrices.get(userId);
    return buildPreferenceMatrix(prefs, stored);
  }

  async setMatrixCell(
    userId: string,
    channel: NotificationChannel,
    category: NotificationCategory,
    enabled: boolean
  ): Promise<PreferenceMatrix> {
    const current = await this.getMatrix(userId);
    current[channel][category] = enabled;
    this.matrices.set(userId, current);
    logger.info('[notifications] matrix cell updated', { userId, channel, category, enabled });
    return current;
  }

  async setMatrix(userId: string, matrix: PreferenceMatrix): Promise<PreferenceMatrix> {
    this.matrices.set(userId, matrix);
    logger.info('[notifications] matrix replaced', { userId });
    return matrix;
  }

  /**
   * Resolve which channels should receive a notification for the user/category.
   */
  async resolveChannels(
    userId: string,
    category: NotificationCategory,
    options: { bypassQuietHours?: boolean; now?: Date } = {}
  ): Promise<ChannelDeliveryResult[]> {
    const prefs = await notificationPreferenceService.getPreferences(userId);
    const matrix = await this.getMatrix(userId);
    const quiet =
      !options.bypassQuietHours &&
      category !== 'security' &&
      isWithinQuietHours(prefs, options.now);

    return NOTIFICATION_CHANNELS.map((channel) => {
      if (quiet) {
        return { channel, delivered: false, reason: 'quiet_hours' };
      }
      if (!prefs[CHANNEL_ENABLED_KEY[channel]]) {
        return { channel, delivered: false, reason: 'channel_disabled' };
      }
      if (!matrix[channel][category]) {
        return { channel, delivered: false, reason: 'matrix_cell_disabled' };
      }
      return { channel, delivered: true };
    });
  }

  async dispatch(payload: NotificationPayload): Promise<DispatchResult> {
    const bypass =
      payload.bypassQuietHours ?? payload.category === 'security';
    const results = await this.resolveChannels(payload.userId, payload.category, {
      bypassQuietHours: bypass,
    });
    const deliveredChannels = results.filter((r) => r.delivered).map((r) => r.channel);

    const notificationId = `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const result: DispatchResult = {
      notificationId,
      userId: payload.userId,
      category: payload.category,
      results,
      deliveredChannels,
    };

    this.deliveries.push(result);
    logger.info('[notifications] dispatched', {
      notificationId,
      userId: payload.userId,
      category: payload.category,
      channels: deliveredChannels,
      title: payload.title,
    });

    return result;
  }

  getDeliveryHistory(userId?: string): DispatchResult[] {
    if (!userId) return [...this.deliveries];
    return this.deliveries.filter((d) => d.userId === userId);
  }

  /** Test helper — clear in-memory state. */
  reset(): void {
    this.matrices.clear();
    this.deliveries = [];
  }
}

export const multiChannelNotifications = new MultiChannelNotificationService();
