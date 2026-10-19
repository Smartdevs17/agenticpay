import { Router, Request, Response } from 'express';
import type { AgenticPayWebSocketServer } from '../websocket/server.js';

export function createWebSocketRouter(wsServer: AgenticPayWebSocketServer) {
  const router = Router();

  router.get('/metrics', (_req: Request, res: Response) => {
    res.status(200).json(wsServer.metrics);
  });

  return router;
}

