import { Router } from 'express';
import { emailService } from '../services/email/index.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const emailRouter = Router();

emailRouter.post(
  '/templates',
  asyncHandler(async (req, res) => {
    const template = await emailService.createTemplate(req.body);
    res.status(201).json(template);
  })
);

emailRouter.get(
  '/templates',
  asyncHandler(async (_req, res) => {
    const templates = await emailService.listTemplates();
    res.json(templates);
  })
);

emailRouter.get(
  '/templates/:id',
  asyncHandler(async (req, res) => {
    const template = await emailService.getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    res.json(template);
  })
);

emailRouter.post(
  '/send',
  asyncHandler(async (req, res) => {
    const delivery = await emailService.sendEmail(req.body);
    res.json(delivery);
  })
);

emailRouter.get(
  '/deliveries',
  asyncHandler(async (req, res) => {
    const status = req.query.status as any;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const deliveries = await emailService.listDeliveries({ status, limit });
    res.json(deliveries);
  })
);

emailRouter.post(
  '/preferences',
  asyncHandler(async (req, res) => {
    const preferences = await emailService.updatePreferences(req.body);
    res.json(preferences);
  })
);

emailRouter.post(
  '/unsubscribe',
  asyncHandler(async (req, res) => {
    const { token } = req.body;
    const success = await emailService.handleUnsubscribe(token);
    res.json({ success });
  })
);