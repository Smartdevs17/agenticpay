import { pushService } from '../../../services/push.js';

export interface PushSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class PushChannel {
  async send(userId: string, title: string, body: string, data?: Record<string, unknown>): Promise<PushSendResult> {
    try {
      // Use existing push service
      const result = await pushService.sendNotification({
        userId,
        title,
        body,
        data
      });

      if (result.sent > 0) {
        return {
          success: true,
          messageId: `push_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
      } else {
        return {
          success: false,
          error: 'Failed to send push notification to any devices'
        };
      }
    } catch (error) {
      console.error('[Push] Failed to send push notification:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}