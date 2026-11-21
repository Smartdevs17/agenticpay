import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { slackIntegrationService } from '../services/slack-integration.js';

export const slackRouter = Router();
slackRouter.get('/', (_req, res) => res.json({ data: slackIntegrationService.list() }));
slackRouter.post('/', asyncHandler(async (req, res) => {
  const { id, webhookUrl, channel, enabled } = req.body;
  if (typeof id !== 'string' || typeof webhookUrl !== 'string') throw new AppError(400, 'id and webhookUrl are required', 'VALIDATION_ERROR');
  try { res.status(201).json({ data: slackIntegrationService.configure({ id, webhookUrl, channel, enabled }) }); }
  catch (error) { throw new AppError(400, error instanceof Error ? error.message : 'Invalid Slack configuration', 'VALIDATION_ERROR'); }
}));
slackRouter.post('/:id/send', asyncHandler(async (req, res) => {
  if (typeof req.body.text !== 'string' || req.body.text.length === 0) throw new AppError(400, 'text is required', 'VALIDATION_ERROR');
  await slackIntegrationService.send(req.params.id, req.body.text);
  res.status(202).json({ ok: true });
}));