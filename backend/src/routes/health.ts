import { Router, Request, Response } from 'express';
import { server as stellarServer } from '../services/stellar.js';
import { getJobScheduler } from '../jobs/index.js';

export const healthRouter = Router();

type HorizonHealthServer = {
  root: () => Promise<unknown>;
};

const horizonHealthServer = stellarServer as unknown as HorizonHealthServer;

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Get service health status
 *     responses:
 *       200:
 *         description: Service is healthy or degraded
 *       503:
 *         description: Service is unhealthy
 */
healthRouter.get('/health', async (_req: Request, res: Response) => {
  const start = Date.now();
  
  const checks = {
    stellar: false,
    openai: false,
    scheduler: false,
  };

  try {
    // 1. Stellar Horizon Check (with timeout)
    const stellarCheck = horizonHealthServer
      .root()
      .then(() => true)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('Stellar health check failed:', message);
        return false;
      });

    // 2. OpenAI Configuration Check
    checks.openai = !!process.env.OPENAI_API_KEY;

    // 3. Scheduler Initialization Check
    checks.scheduler = !!getJobScheduler();

    // Race Stellar check against a 800ms timeout to keep health check fast
    checks.stellar = await Promise.race([
      stellarCheck,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 800))
    ]) as boolean;

  } catch (error) {
    console.error('Unexpected error during health check:', error);
  }

  const dependencies = {
    stellar: checks.stellar ? 'healthy' : 'unhealthy',
    openai: checks.openai ? 'healthy' : 'unhealthy',
    scheduler: checks.scheduler ? 'healthy' : 'unhealthy',
  };

  const isUnhealthy = dependencies.stellar === 'unhealthy' || dependencies.scheduler === 'unhealthy';
  const isDegraded = dependencies.openai === 'unhealthy';

  let overallStatus = 'healthy';
  if (isUnhealthy) {
    overallStatus = 'unhealthy';
  } else if (isDegraded) {
    overallStatus = 'degraded';
  }

  res.status(overallStatus === 'unhealthy' ? 503 : 200).json({
    status: overallStatus,
    service: 'agenticpay-backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    dependencies,
    latency_ms: Date.now() - start
  });
});

/**
 * @openapi
 * /ready:
 *   get:
 *     summary: Kubernetes readiness probe
 *     responses:
 *       200:
 *         description: Service is ready
 */
healthRouter.get('/ready', (_req: Request, res: Response) => {
  // Application is ready if the router is mounted and responding
  res.status(200).json({
    status: 'ready',
    timestamp: new Date().toISOString()
  });
});
