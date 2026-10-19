import { Router, Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { NotificationService } from '../services/notificationService.js';

export const notificationsRouter = Router();

// Initialize notification service
const notificationService = new NotificationService();

// Send notification endpoint
notificationsRouter.post('/send', asyncHandler(async (req: Request, res: Response) => {
  const { templateId, variables, channels, userId, recipient, priority, scheduledFor } = req.body;

  if (!templateId || !userId) {
    res.status(400).json({ error: 'Missing templateId or userId' });
    return;
  }

  const payload = {
    templateId,
    variables: variables || {},
    channels: channels || ['email', 'push', 'in-app'],
    userId,
    recipient,
    priority,
    scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined
  };

  const result = await notificationService.sendNotification(payload);
  res.status(200).json(result);
}));

// Get notification preferences
notificationsRouter.get('/preferences/:userId', asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  // For now, we'll use the preference service directly
  // In a real implementation, we'd want to inject this properly
  const { NotificationPreferenceService } = require('../services/notifications/preferenceService.js');
  const preferenceService = new NotificationPreferenceService();
  const preferences = await preferenceService.getPreferences(userId);
  res.status(200).json(preferences);
}));

// Update notification preferences
notificationsRouter.put('/preferences/:userId', asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { NotificationPreferenceService } = require('../services/notifications/preferenceService.js');
  const preferenceService = new NotificationPreferenceService();
  const preferences = await preferenceService.updatePreferences(userId, req.body);
  res.status(200).json(preferences);
}));

// Get notification templates
notificationsRouter.get('/templates', asyncHandler(async (req: Request, res: Response) => {
  const { NotificationTemplateService } = require('../services/notifications/templateService.js');
  const templateService = new NotificationTemplateService();
  const templates = templateService.getAllTemplates();
  res.status(200).json({ templates });
}));

// Get specific notification template
notificationsRouter.get('/templates/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { NotificationTemplateService } = require('../services/notifications/templateService.js');
  const templateService = new NotificationTemplateService();
  const template = templateService.getTemplate(id);
  
  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  
  res.status(200).json(template);
}));

// Create/update notification template
notificationsRouter.post('/templates', asyncHandler(async (req: Request, res: Response) => {
  const { NotificationTemplateService } = require('../services/notifications/templateService.js');
  const templateService = new NotificationTemplateService();
  const template = req.body;
  
  if (!template.id || !template.name || !template.subject || !template.body) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  
  templateService.addTemplate(template);
  res.status(201).json(template);
}));

// Get delivery status
notificationsRouter.get('/delivery/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { DeliveryTracker } = require('../services/notifications/deliveryTracker.js');
  const deliveryTracker = new DeliveryTracker();
  const delivery = await deliveryTracker.getDelivery(id);
  
  if (!delivery) {
    res.status(404).json({ error: 'Delivery record not found' });
    return;
  }
  
  res.status(200).json(delivery);
}));

// Get deliveries for a notification
notificationsRouter.get('/delivery/notification/:notificationId', asyncHandler(async (req: Request, res: Response) => {
  const { notificationId } = req.params;
  const { DeliveryTracker } = require('../services/notifications/deliveryTracker.js');
  const deliveryTracker = new DeliveryTracker();
  const deliveries = await deliveryTracker.getDeliveriesForNotification(notificationId);
  res.status(200).json({ deliveries });
}));

// Get deliveries for a user
notificationsRouter.get('/delivery/user/:userId', asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { limit = 50, offset = 0 } = req.query;
  const { DeliveryTracker } = require('../services/notifications/deliveryTracker.js');
  const deliveryTracker = new DeliveryTracker();
  const deliveries = await deliveryTracker.getDeliveriesForUser(userId, parseInt(limit as string), parseInt(offset as string));
  res.status(200).json({ deliveries });
}));

// Retry failed deliveries
notificationsRouter.post('/retry', asyncHandler(async (req: Request, res: Response) => {
  const { DeliveryTracker } = require('../services/notifications/deliveryTracker.js');
  const deliveryTracker = new DeliveryTracker();
  const failedDeliveries = await deliveryTracker.getFailedDeliveriesForRetry();
  
  // In a real implementation, we would actually retry sending these
  // For now, we'll just return the list
  res.status(200).json({ 
    message: `Found ${failedDeliveries.length} failed deliveries ready for retry`,
    deliveries: failedDeliveries
  });
}));