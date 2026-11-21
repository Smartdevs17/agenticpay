/**
 * AI Dispute Mediation Routes
 *
 * POST /disputes/:id/mediate      — trigger AI analysis on a dispute
 * POST /disputes/:id/human-resolve — mediator submits manual decision
 * GET  /disputes/escalation-queue  — list disputes awaiting human review
 * GET  /disputes/analytics         — resolution trend analytics
 * GET  /disputes/:id/mediation-log — fetch AI log for a dispute
 */

import { Router, type Request, type Response } from 'express';
import {
  runAIMediation,
  applyHumanResolution,
  getDispute,
  getEscalationQueue,
  getDisputeAnalytics,
  listDisputes,
  createDispute,
} from '../services/disputes/resolution-engine.js';
import { getMediationLog } from '../services/disputes/ai-mediator.js';

const router = Router();

// Trigger AI mediation on an existing dispute
router.post('/:id/mediate', async (req: Request, res: Response) => {
  try {
    const result = await runAIMediation(req.params.id);
    res.json({ success: true, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Human mediator overrides or confirms AI recommendation
router.post('/:id/human-resolve', async (req: Request, res: Response) => {
  try {
    const { decision, note, refundAmount, mediatorId } = req.body as {
      decision: string;
      note: string;
      refundAmount?: number;
      mediatorId?: string;
    };

    if (!decision || !note) {
      res.status(400).json({ error: 'decision and note are required' });
      return;
    }

    const resolution = await applyHumanResolution(
      req.params.id,
      mediatorId ?? 'system',
      decision as Parameters<typeof applyHumanResolution>[2],
      note,
      refundAmount
    );

    res.json({ success: true, resolution });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Escalation queue — disputes awaiting human review
router.get('/escalation-queue', (_req: Request, res: Response) => {
  const queue = getEscalationQueue();
  res.json({ count: queue.length, disputes: queue });
});

// Analytics dashboard
router.get('/analytics', (_req: Request, res: Response) => {
  const analytics = getDisputeAnalytics();
  res.json(analytics);
});

// AI mediation log for a specific dispute
router.get('/:id/mediation-log', (req: Request, res: Response) => {
  const log = getMediationLog(req.params.id);
  if (!log) {
    res.status(404).json({ error: 'No mediation log found for this dispute' });
    return;
  }
  res.json(log);
});

// Get dispute detail
router.get('/:id', (req: Request, res: Response) => {
  const dispute = getDispute(req.params.id);
  if (!dispute) {
    res.status(404).json({ error: 'Dispute not found' });
    return;
  }
  res.json(dispute);
});

// List disputes, optionally filtered by status
router.get('/', (req: Request, res: Response) => {
  const status = req.query.status as Parameters<typeof listDisputes>[0];
  res.json(listDisputes(status));
});

// Create dispute (for testing / integration)
router.post('/', async (req: Request, res: Response) => {
  try {
    const dispute = await createDispute(req.body);
    res.status(201).json(dispute);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

export default router;
