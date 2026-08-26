import { Router, Request, Response } from 'express';
import type { AgenticPayWebSocketServer } from '../websocket/server.js';
import type { ConnectionManager } from '../websocket/connection-manager.js';

export function createWebSocketRouter(
  wsServer: AgenticPayWebSocketServer,
  connectionManager?: ConnectionManager,
) {
  const router = Router();

  router.get('/metrics', (_req: Request, res: Response) => {
    const metrics = connectionManager
      ? connectionManager.getAggregatedMetrics()
      : wsServer.metrics;
    res.status(200).json(metrics);
  });

  return router;
}

