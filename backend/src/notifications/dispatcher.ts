/**
 * Notification dispatcher with channel routing and fallback logic
 */

import {
  Notification,
  NotificationDeliveryResult,
  UserNotificationPreference,
} from "./channel-interface";
import { channelRegistry } from "./channel-registry";

export interface DispatchResult {
  notificationId: string;
  deliveries: NotificationDeliveryResult[];
  success: boolean;
  fallbackUsed: boolean;
}

export class NotificationDispatcher {
  /**
   * Dispatch notification to user's preferred channels with fallback
   */
  async dispatch(
    notification: Notification,
    preferences?: UserNotificationPreference,
  ): Promise<DispatchResult> {
    const deliveries: NotificationDeliveryResult[] = [];
    let success = false;
    let fallbackUsed = false;

    // Check quiet hours
    if (preferences && this.isQuietHours(preferences)) {
      console.log(
        `Skipping notification during quiet hours for user ${notification.userId}`,
      );
      return {
        notificationId: notification.id,
        deliveries: [],
        success: false,
        fallbackUsed: false,
      };
    }

    // Get user's preferred channels or default
    const preferredChannels = preferences?.channels || [];
    const channels = channelRegistry.getChannelsForEvent(
      notification.eventType,
      preferredChannels,
    );

    if (channels.length === 0) {
      console.warn("No channels available for notification");
      return {
        notificationId: notification.id,
        deliveries: [],
        success: false,
        fallbackUsed: false,
      };
    }

    // Try primary channel
    const primaryChannel = channels[0];
    console.log(`Dispatching to primary channel: ${primaryChannel.id}`);

    const primaryResult = await primaryChannel.send(notification);
    deliveries.push(primaryResult);

    if (primaryResult.success) {
      success = true;
    } else {
      // Fallback chain
      console.warn(
        `Primary channel ${primaryChannel.id} failed: ${primaryResult.error}`,
      );

      for (let i = 1; i < channels.length; i++) {
        const fallbackChannel = channels[i];
        console.log(`Trying fallback channel: ${fallbackChannel.id}`);

        fallbackUsed = true;
        const fallbackResult = await fallbackChannel.send(notification);
        deliveries.push(fallbackResult);

        if (fallbackResult.success) {
          success = true;
          console.log(`Fallback channel ${fallbackChannel.id} succeeded`);
          break;
        }
      }
    }

    // Store delivery results
    await this.storeDeliveryResults(notification.id, deliveries);

    return {
      notificationId: notification.id,
      deliveries,
      success,
      fallbackUsed,
    };
  }

  /**
   * Batch dispatch to multiple users
   */
  async batchDispatch(
    notifications: Notification[],
    preferencesMap: Map<string, UserNotificationPreference>,
  ): Promise<DispatchResult[]> {
    const results = await Promise.allSettled(
      notifications.map((notification) => {
        const preferences = preferencesMap.get(notification.userId);
        return this.dispatch(notification, preferences);
      }),
    );

    return results
      .filter((result) => result.status === "fulfilled")
      .map(
        (result) => (result as PromiseFulfilledResult<DispatchResult>).value,
      );
  }

  /**
   * Check if current time is within user's quiet hours
   */
  private isQuietHours(preferences: UserNotificationPreference): boolean {
    if (
      preferences.quietHoursStart === undefined ||
      preferences.quietHoursEnd === undefined
    ) {
      return false;
    }

    const now = new Date();
    const currentHour = now.getHours();

    const start = preferences.quietHoursStart;
    const end = preferences.quietHoursEnd;

    if (start <= end) {
      return currentHour >= start && currentHour < end;
    } else {
      // Quiet hours cross midnight
      return currentHour >= start || currentHour < end;
    }
  }

  /**
   * Store delivery results for analytics
   */
  private async storeDeliveryResults(
    notificationId: string,
    deliveries: NotificationDeliveryResult[],
  ): Promise<void> {
    try {
      // Store in database
      // await db.notificationDelivery.createMany({ data: deliveries });
      console.log(`Stored delivery results for notification ${notificationId}`);
    } catch (error) {
      console.error("Failed to store delivery results:", error);
    }
  }

  /**
   * Get delivery statistics for a notification
   */
  async getDeliveryStats(notificationId: string): Promise<{
    totalAttempts: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    averageDeliveryTimeMs: number;
  }> {
    // Fetch from database
    // const deliveries = await db.notificationDelivery.findMany({ where: { notificationId } });

    return {
      totalAttempts: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      averageDeliveryTimeMs: 0,
    };
  }

  /**
   * Test all channels for a user
   */
  async testChannels(userId: string): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const testNotification: Notification = {
      id: `test-${Date.now()}`,
      userId,
      eventType: "test",
      title: "Test Notification",
      body: "This is a test notification",
      priority: "normal",
      createdAt: new Date(),
    };

    const channels = channelRegistry.getEnabled();

    for (const channel of channels) {
      const result = await channel.send(testNotification);
      results.set(channel.id, result.success);
    }

    return results;
  }
}

export const notificationDispatcher = new NotificationDispatcher();
