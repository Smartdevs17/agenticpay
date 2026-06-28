/**
 * Webhook DLQ & Delivery Health Routes
 *
 * GET  /webhooks/health                     — delivery health dashboard
 * GET  /webhooks/delivery-logs              — paginated delivery log list
 * GET  /webhooks/delivery-logs/export.csv   — CSV export
 * GET  /webhooks/dlq                        — list dead-letter queue entries
 * GET  /webhooks/dlq/stats                  — DLQ statistics
 * POST /webhooks/dlq/:id/replay             — replay single DLQ entry
 * POST /webhooks/dlq/replay-batch           — replay multiple entries
 * POST /webhooks/dlq/replay-all             — replay all entries (merchant-scoped)
 * DELETE /webhooks/dlq/:id                  — purge single DLQ entry
 * PUT  /webhooks/endpoints/:id/retry-policy — update endpoint retry policy
 */

import { Router, type Request, type Response } from 'express';
import {
  getDeliveryHealth,
  listDeliveryLogs,
  exportDeliveryLogsCSV,
  updateEndpointRetryPolicy,
  listEndpoints,
  registerEndpoint,
  DEFAULT_RETRY_POLICY,
} from '../services/webhooks/delivery-manager.js';
import {
  listDLQ,
  getDLQEntry,
  getDLQStats,
  replaySingle,
  replayBatch,
  replayAll,
  purgeDLQEntry,
  syncDLQFromDeliveryLogs,
} from '../services/webhooks/dead-letter-queue.js';

const router = Router();

// ---------------------------------------------------------------------------
// Delivery health dashboard
// ---------------------------------------------------------------------------

router.get('/health', (req: Request, res: Response) => {
  const merchantId = req.query.merchantId as string | undefined;
  const health = getDeliveryHealth(merchantId);

  if (health.alertTriggered) {
    res.setHeader('X-Webhook-Alert', 'success-rate-below-99');
  }

  res.json(health);
});

// ---------------------------------------------------------------------------
// Delivery logs
// ---------------------------------------------------------------------------

router.get('/delivery-logs', (req: Request, res: Response) => {
  const { endpointId, merchantId, status } = req.query as Record<string, string>;
  const logs = listDeliveryLogs({ endpointId, merchantId, status: status as Parameters<typeof listDeliveryLogs>[0]['status'] });
  res.json({ count: logs.length, logs });
});

router.get('/delivery-logs/export.csv', (req: Request, res: Response) => {
  const merchantId = req.query.merchantId as string | undefined;
  const csv = exportDeliveryLogsCSV(merchantId);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="webhook-delivery-logs.csv"');
  res.send(csv);
});

// ---------------------------------------------------------------------------
// Dead-letter queue
// ---------------------------------------------------------------------------

router.get('/dlq', (req: Request, res: Response) => {
  syncDLQFromDeliveryLogs();
  const { merchantId, endpointId, failureCategory } = req.query as Record<string, string>;
  const entries = listDLQ({
    merchantId,
    endpointId,
    failureCategory: failureCategory as Parameters<typeof listDLQ>[0]['failureCategory'],
  });
  res.json({ count: entries.length, entries });
});

router.get('/dlq/stats', (req: Request, res: Response) => {
  syncDLQFromDeliveryLogs();
  const merchantId = req.query.merchantId as string | undefined;
  res.json(getDLQStats(merchantId));
});

router.get('/dlq/:id', (req: Request, res: Response) => {
  const entry = getDLQEntry(req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'DLQ entry not found' });
    return;
  }
  res.json(entry);
});

// Replay single
router.post('/dlq/:id/replay', async (req: Request, res: Response) => {
  try {
    const result = await replaySingle(req.params.id);
    res.json({ success: true, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Replay batch
router.post('/dlq/replay-batch', async (req: Request, res: Response) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'ids array is required' });
    return;
  }

  const results = await replayBatch(ids);
  res.json({ replayed: results.length, results });
});

// Replay all
router.post('/dlq/replay-all', async (req: Request, res: Response) => {
  const merchantId = (req.query.merchantId ?? req.body?.merchantId) as string | undefined;
  const results = await replayAll(merchantId);
  res.json({ replayed: results.length, results });
});

// Purge
router.delete('/dlq/:id', (req: Request, res: Response) => {
  try {
    purgeDLQEntry(req.params.id);
    res.json({ success: true, purged: req.params.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Endpoint management
// ---------------------------------------------------------------------------

router.get('/endpoints', (req: Request, res: Response) => {
  const merchantId = req.query.merchantId as string | undefined;
  res.json(listEndpoints(merchantId));
});

router.post('/endpoints', (req: Request, res: Response) => {
  const { merchantId, url, secret, enabled, retryPolicy } = req.body as {
    merchantId: string;
    url: string;
    secret: string;
    enabled?: boolean;
    retryPolicy?: Partial<typeof DEFAULT_RETRY_POLICY>;
  };

  if (!merchantId || !url || !secret) {
    res.status(400).json({ error: 'merchantId, url, and secret are required' });
    return;
  }

  const endpoint = registerEndpoint({
    merchantId,
    url,
    secret,
    enabled: enabled ?? true,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, ...(retryPolicy ?? {}) },
  });

  res.status(201).json(endpoint);
});

router.put('/endpoints/:id/retry-policy', (req: Request, res: Response) => {
  try {
    const updated = updateEndpointRetryPolicy(req.params.id, req.body);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

export default router;
