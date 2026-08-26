/**
 * Collaboration REST Routes
 *
 * GET /collaboration/:projectId/history      — paginated edit history
 * GET /collaboration/:projectId/participants — active participants
 * GET /collaboration/:projectId/locks        — locked fields
 */

import { Router, type Request, type Response } from 'express';
import {
  getEditHistory,
  getSessionParticipants,
  getLockedFields,
} from '../websocket/collaboration.js';

const router = Router();

router.get('/:projectId/history', (req: Request, res: Response) => {
  const limit = parseInt(String(req.query.limit ?? '100'), 10);
  const history = getEditHistory(req.params.projectId, limit);
  res.json({ projectId: req.params.projectId, count: history.length, history });
});

router.get('/:projectId/participants', (req: Request, res: Response) => {
  const participants = getSessionParticipants(req.params.projectId);
  res.json({ projectId: req.params.projectId, count: participants.length, participants });
});

router.get('/:projectId/locks', (req: Request, res: Response) => {
  const locks = getLockedFields(req.params.projectId);
  res.json({ projectId: req.params.projectId, locks });
});

export default router;
