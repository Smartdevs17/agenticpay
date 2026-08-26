import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import * as routingService from '../services/routing.js';

export const routingRouter = Router();

const routeRequestSchema = z.object({
  amount: z.number().positive(),
  fromAsset: z.string().min(1),
  toAsset: z.string().optional(),
  fromNetwork: z.string().optional(),
  toNetwork: z.string().optional(),
  preference: z.object({
    prioritize: z.enum(['cost', 'speed', 'reliability', 'balanced']).optional(),
    maxCost: z.number().positive().optional(),
    maxLatencyMs: z.number().positive().optional(),
    minReliability: z.number().min(0).max(1).optional(),
  }).optional(),
  merchantId: z.string().optional(),
});

const healthUpdateSchema = z.object({
  network: z.string().min(1),
  status: z.enum(['healthy', 'degraded', 'down']).optional(),
  avgLatencyMs: z.number().min(0).optional(),
  errorRate24h: z.number().min(0).optional(),
  uptime7d: z.number().min(0).max(100).optional(),
  blockHeight: z.number().int().min(0).optional(),
});

routingRouter.get('/networks', asyncHandler(async (_req: Request, res: Response) => {
  const routes = routingService.getNetworkRoutes();
  res.json({ networks: routes });
}));

routingRouter.get('/strategies', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ strategies: routingService.getRouteStrategies() });
}));

routingRouter.post('/route', validate(routeRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await routingService.findRoute(req.body);
  res.json(result);
}));

routingRouter.post('/execute', validate(routeRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await routingService.executeRoute(req.body);
  res.json(result);
}));

routingRouter.get('/scored', asyncHandler(async (req: Request, res: Response) => {
  const prioritize = (req.query.prioritize as string) || 'balanced';
  const preference = { prioritize: prioritize as 'cost' | 'speed' | 'reliability' | 'balanced' };
  const scored = routingService.getScoredRoutes(preference);
  res.json({ routes: scored });
}));

routingRouter.get('/analytics', asyncHandler(async (_req: Request, res: Response) => {
  const analytics = routingService.getRouteAnalytics();
  res.json(analytics);
}));

routingRouter.post('/networks/health', validate(healthUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  const { network, ...health } = req.body;
  routingService.updateNetworkHealth(network, health);
  res.json({ success: true });
}));
