import { Router, Request, Response } from 'express';
import { pushService } from '../services/push.js';
import { authMiddleware } from '../middleware/auth.js';
import { NotificationCategory } from '@prisma/client';

export const pushRouter = Router();

// All routes require authentication
pushRouter.use(authMiddleware);

/**
 * Subscribe to push notifications
 * POST /api/v1/push/subscribe
 */
pushRouter.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const { subscription } = req.body;
    const userId = (req as any).user?.id;
    const tenantId = (req as any).user?.tenantId;
    const userAgent = req.get('user-agent');

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({
        error: {
          code: 'INVALID_SUBSCRIPTION',
          message: 'Push subscription with endpoint is required',
          status: 400,
        },
      });
    }

    if (!subscription.keys || !subscription.keys.auth || !subscription.keys.p256dh) {
      return res.status(400).json({
        error: {
          code: 'INVALID_SUBSCRIPTION',
          message: 'Push subscription keys (auth, p256dh) are required',
          status: 400,
        },
      });
    }

    const result = await pushService.subscribe(
      tenantId,
      userId,
      subscription,
      userAgent
    );

    res.status(201).json(result);
  } catch (error) {
    console.error('Push subscription error:', error);
    res.status(500).json({
      error: {
        code: 'SUBSCRIPTION_FAILED',
        message: 'Failed to subscribe to push notifications',
        status: 500,
      },
    });
  }
});

/**
 * Unsubscribe from push notifications
 * DELETE /api/v1/push/unsubscribe
 */
pushRouter.delete('/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body;
    const userId = (req as any).user?.id;
    const tenantId = (req as any).user?.tenantId;

    if (!endpoint) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Endpoint is required',
          status: 400,
        },
      });
    }

    await pushService.unsubscribe(tenantId, userId, endpoint);
    res.status(204).send();
  } catch (error) {
    console.error('Push unsubscription error:', error);
    res.status(500).json({
      error: {
        code: 'UNSUBSCRIPTION_FAILED',
        message: 'Failed to unsubscribe from push notifications',
        status: 500,
      },
    });
  }
});

/**
 * Send push notification
 * POST /api/v1/push/notify
 * (typically admin/backend use only)
 */
pushRouter.post('/notify', async (req: Request, res: Response) => {
  try {
    const {
      userId: targetUserId,
      category,
      title,
      body,
      icon,
      badge,
      data,
      tag,
      deepLink,
      actions,
    } = req.body;
    const tenantId = (req as any).user?.tenantId;

    if (!targetUserId || !title || !category) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'userId, title, and category are required',
          status: 400,
        },
      });
    }

    // Validate category
    const validCategories: NotificationCategory[] = [
      'payment_notification',
      'dispute_alert',
      'project_update',
      'milestone_reminder',
      'security_alert',
      'subscription_update',
      'system_notification',
    ];

    if (!validCategories.includes(category as NotificationCategory)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_CATEGORY',
          message: `Invalid notification category. Must be one of: ${validCategories.join(', ')}`,
          status: 400,
        },
      });
    }

    const result = await pushService.sendNotification({
      tenantId,
      userId: targetUserId,
      category: category as NotificationCategory,
      title,
      body,
      icon,
      badge,
      data,
      tag,
      deepLink,
      actions,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Push notification error:', error);
    res.status(500).json({
      error: {
        code: 'NOTIFICATION_FAILED',
        message: 'Failed to send push notification',
        status: 500,
      },
    });
  }
});

/**
 * Get VAPID public key (public endpoint)
 * GET /api/v1/push/vapid-public-key
 */
pushRouter.get('/vapid-public-key', (req: Request, res: Response) => {
  try {
    const publicKey = pushService.getVapidPublicKey();
    res.status(200).json({ publicKey });
  } catch (error) {
    console.error('Get VAPID public key error:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to fetch VAPID public key',
        status: 500,
      },
    });
  }
});

/**
 * Get user notification preferences
 * GET /api/v1/push/preferences
 */
pushRouter.get('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const tenantId = (req as any).user?.tenantId;

    const preferences = await pushService.getPreferences(tenantId, userId);
    res.status(200).json(preferences);
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to fetch notification preferences',
        status: 500,
      },
    });
  }
});

/**
 * Update user notification preferences
 * PUT /api/v1/push/preferences
 */
pushRouter.put('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const tenantId = (req as any).user?.tenantId;
    const preferences = req.body;

    const result = await pushService.updatePreferences(tenantId, userId, preferences);
    res.status(200).json(result);
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      error: {
        code: 'UPDATE_FAILED',
        message: 'Failed to update notification preferences',
        status: 500,
      },
    });
  }
});

/**
 * Get notification history
 * GET /api/v1/push/history
 */
pushRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const tenantId = (req as any).user?.tenantId;
    const limit = parseInt(req.query.limit as string) || 50;

    const notifications = await pushService.getNotificationHistory(tenantId, userId, limit);
    res.status(200).json(notifications);
  } catch (error) {
    console.error('Get notification history error:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to fetch notification history',
        status: 500,
      },
    });
  }
});

/**
 * Mark notification as clicked
 * POST /api/v1/push/mark-clicked/:notificationId
 */
pushRouter.post('/mark-clicked/:notificationId', async (req: Request, res: Response) => {
  try {
    const { notificationId } = req.params;
    const tenantId = (req as any).user?.tenantId;

    await pushService.markNotificationAsClicked(tenantId, notificationId);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Mark clicked error:', error);
    res.status(500).json({
      error: {
        code: 'UPDATE_FAILED',
        message: 'Failed to mark notification as clicked',
        status: 500,
      },
    });
  }
});