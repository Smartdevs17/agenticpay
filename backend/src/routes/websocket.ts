/**
 * Issue #823 — Real-time WebSocket API for live updates
 *
 * REST management routes for the WebSocket server.
 * All mounted under /api/v1/ws
 *
 *   GET  /status   — server health and connection metrics
 *   GET  /channels — list of available broadcast channels
 *   POST /broadcast — internal/admin broadcast endpoint (admin-only in production)
 */

import { Router, Request, Response } from 'express';
import type { AgenticPayWebSocketServer } from '../websocket/server.js';
import type { ConnectionManager } from '../websocket/connection-manager.js';
import { liveBroadcast } from '../websocket/live-broadcast.js';

const WS_CHANNELS = [
  {
    name: 'payment.events',
    description: 'Payment lifecycle events: created, updated, settled, failed',
    events: ['payment.created', 'payment.updated', 'payment.settled', 'payment.failed'],
  },
  {
    name: 'dispute.updates',
    description: 'Dispute lifecycle events: opened, resolved, escalated',
    events: ['dispute.opened', 'dispute.resolved', 'dispute.escalated'],
  },
  {
    name: 'analytics.updates',
    description: 'Periodic analytics and connection metric snapshots',
    events: ['analytics.snapshot'],
  },
  {
    name: 'indexer.all',
    description: 'All Soroban / EVM indexer events across all contracts',
    events: ['indexer.event'],
  },
] as const;

export function createWebSocketRouter(
  wsServer: AgenticPayWebSocketServer,
  connectionManager?: ConnectionManager,
) {
  const router = Router();

  /** GET /status — server health and live metrics */
  router.get('/status', (_req: Request, res: Response) => {
    const metrics = connectionManager
      ? connectionManager.getAggregatedMetrics()
      : wsServer.metrics;
    res.status(200).json({
      status: 'ok',
      websocketPath: '/ws',
      channels: WS_CHANNELS.map((c) => c.name),
      metrics,
      timestamp: new Date().toISOString(),
    });
  });

  /** GET /channels — list all subscribable channels with descriptions */
  router.get('/channels', (_req: Request, res: Response) => {
    res.status(200).json({
      data: WS_CHANNELS,
      total: WS_CHANNELS.length,
      note: 'Connect to ws[s]://HOST/ws and send {"type":"subscribe","channels":["payment.events"]}',
    });
  });

  /**
   * POST /broadcast — admin broadcast (for testing / internal tooling)
   * Body: { channel: string; type: string; payload?: unknown }
   */
  router.post('/broadcast', (req: Request, res: Response) => {
    const { channel, type, payload } = req.body as {
      channel?: string;
      type?: string;
      payload?: unknown;
    };

    if (!channel || typeof channel !== 'string') {
      res.status(400).json({ error: 'channel is required' });
      return;
    }
    if (!type || typeof type !== 'string') {
      res.status(400).json({ error: 'type is required' });
      return;
    }

    liveBroadcast.raw(channel, { type, payload });
    res.status(200).json({
      ok: true,
      channel,
      type,
      sentAt: new Date().toISOString(),
    });
  });

  return router;
}
