import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { githubIntegrationService } from '../services/github-integration.js';

export const githubIntegrationRouter = Router();
githubIntegrationRouter.get('/repositories', asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) throw new AppError(401, 'GitHub bearer token is required', 'UNAUTHORIZED');
  res.json({ data: await githubIntegrationService.listRepositories(token) });
}));
githubIntegrationRouter.post('/verify', asyncHandler(async (req, res) => {
  const { repositoryUrl, token } = req.body;
  if (typeof repositoryUrl !== 'string') throw new AppError(400, 'repositoryUrl is required', 'VALIDATION_ERROR');
  res.json({ data: await githubIntegrationService.verifyRepository(repositoryUrl, typeof token === 'string' ? token : undefined) });
}));