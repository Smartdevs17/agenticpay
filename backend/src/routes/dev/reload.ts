import { Router, Request, Response } from 'express';
import { createModuleLogger } from '../../middleware/logger.js';

const log = createModuleLogger('dev-reload');
const router = Router();

interface ContractReloadPayload {
  type: string;
  source: 'evm' | 'soroban';
  timestamp: string;
}

/**
 * POST /api/dev/reload
 *
 * Receives notifications from the contract watch script when contracts
 * are recompiled and redeployed. Relays the notification to the
 * WebSocket server so connected frontend dev servers can refresh bindings.
 */
router.post('/reload', (req: Request, res: Response) => {
  const payload = req.body as ContractReloadPayload;

  if (!payload || !payload.type || !payload.source) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  log.info(`Contract reload: ${payload.source} (${payload.type})`);

  // The WebSocket server reference is attached to the app
  const wsServer = req.app.get('wsServer');
  if (wsServer && typeof wsServer.broadcastToChannel === 'function') {
    wsServer.broadcastToChannel('dev.reload', {
      type: 'contracts:updated',
      payload: {
        source: payload.source,
        timestamp: payload.timestamp,
      },
    });
  }

  res.json({ received: true, source: payload.source });
});

/**
 * GET /api/dev/logs
 *
 * Returns current log buffer from the dev transport.
 */
router.get('/logs', (req: Request, res: Response) => {
  try {
    const { getLogBuffer, getDevLogStats } = require('../../logger/dev-transport.js');
    res.json({
      logs: getLogBuffer().slice(-200),
      stats: getDevLogStats(),
    });
  } catch {
    res.status(501).json({ error: 'Dev log transport not available' });
  }
});

/**
 * DELETE /api/dev/logs
 *
 * Clears the log buffer.
 */
router.delete('/logs', (_req: Request, res: Response) => {
  try {
    const { clearLogBuffer } = require('../../logger/dev-transport.js');
    clearLogBuffer();
    res.json({ cleared: true });
  } catch {
    res.status(501).json({ error: 'Dev log transport not available' });
  }
});

export default router;
