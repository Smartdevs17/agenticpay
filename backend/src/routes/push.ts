import { Router, Request, Response } from 'express';
import { pushService } from '../services/push.js';

export const pushRouter = Router();

pushRouter.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const { subscription, userId } = req.body;
    
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({
        error: {
          code: 'INVALID_SUBSCRIPTION',
          message: 'Push subscription is required',
          status: 400,
        },
      });
    }

    const result = await pushService.subscribe(userId, subscription);
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

pushRouter.delete('/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { endpoint, userId } = req.body;
    
    if (!endpoint) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Endpoint is required',
          status: 400,
        },
      });
    }

    await pushService.unsubscribe(userId, endpoint);
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

pushRouter.post('/notify', async (req: Request, res: Response) => {
  try {
    const { userId, title, body, icon, badge, data, actions } = req.body;
    
    if (!userId || !title) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'userId and title are required',
          status: 400,
        },
      });
    }

    const result = await pushService.sendNotification({
      userId,
      title,
      body,
      icon,
      badge,
      data,
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

pushRouter.get('/vapid-public-key', (req: Request, res: Response) => {
  const publicKey = pushService.getVapidPublicKey();
  res.status(200).json({ publicKey });
});

pushRouter.get('/preferences/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const preferences = await pushService.getPreferences(userId);
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

pushRouter.put('/preferences/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const preferences = req.body;
    
    const result = await pushService.updatePreferences(userId, preferences);
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