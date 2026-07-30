/**
 * comments.ts — Issue #596
 *
 * Collaboration comments REST API routes.
 *
 * POST   /comments                                  — add comment
 * GET    /comments/:id                              — get comment
 * PATCH  /comments/:id                              — edit comment
 * DELETE /comments/:id                              — delete comment
 * GET    /comments/:id/thread                       — get thread
 * POST   /comments/:id/reactions                    — add/toggle reaction
 * POST   /comments/:id/vote                         — vote up/down
 * GET    /comments/project/:projectId               — list project comments
 * GET    /comments/project/:projectId/activity      — activity feed
 * GET    /comments/project/:projectId/search        — search comments
 * GET    /comments/notifications/:userId            — user mention notifications
 * POST   /comments/notifications/:userId/read       — mark notifications read
 */

import { Router, type Request, type Response } from 'express';
import {
  commentService,
  type ReactionEmoji,
  type CommentTargetType,
  type FileAnnotation,
} from '../services/comments.js';

const router = Router();

// ── POST /comments ────────────────────────────────────────────────────────────

router.post('/', (req: Request, res: Response) => {
  const {
    projectId,
    targetType,
    targetId,
    parentId,
    authorId,
    authorName,
    body,
    annotation,
  } = req.body as {
    projectId?: string;
    targetType?: string;
    targetId?: string;
    parentId?: string;
    authorId?: string;
    authorName?: string;
    body?: string;
    annotation?: unknown;
  };

  if (!projectId || !targetType || !targetId || !authorId || !authorName || !body) {
    return res.status(400).json({
      success: false,
      error: 'projectId, targetType, targetId, authorId, authorName and body are required',
    });
  }

  const result = commentService.addComment({
    projectId,
    targetType: targetType as CommentTargetType,
    targetId,
    parentId,
    authorId,
    authorName,
    body,
    annotation: annotation as FileAnnotation | undefined,
  });

  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.status(201).json({ success: true, data: result.value });
});

// ── GET /comments/:id ─────────────────────────────────────────────────────────

router.get('/:id', (req: Request, res: Response) => {
  const result = commentService.getComment(req.params.id);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 404).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── PATCH /comments/:id ───────────────────────────────────────────────────────

router.patch('/:id', (req: Request, res: Response) => {
  const { userId, body } = req.body as { userId?: string; body?: string };
  if (!userId || !body) {
    return res.status(400).json({ success: false, error: 'userId and body are required' });
  }

  const result = commentService.editComment(req.params.id, userId, body);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── DELETE /comments/:id ──────────────────────────────────────────────────────

router.delete('/:id', (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  const result = commentService.deleteComment(req.params.id, userId);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── GET /comments/:id/thread ──────────────────────────────────────────────────

router.get('/:id/thread', (req: Request, res: Response) => {
  const result = commentService.getThread(req.params.id);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 404).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── POST /comments/:id/reactions ──────────────────────────────────────────────

router.post('/:id/reactions', (req: Request, res: Response) => {
  const { userId, emoji } = req.body as { userId?: string; emoji?: string };
  if (!userId || !emoji) {
    return res.status(400).json({ success: false, error: 'userId and emoji are required' });
  }

  const result = commentService.addReaction(req.params.id, userId, emoji as ReactionEmoji);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── POST /comments/:id/vote ───────────────────────────────────────────────────

router.post('/:id/vote', (req: Request, res: Response) => {
  const { userId, direction } = req.body as { userId?: string; direction?: string };
  if (!userId || !['up', 'down'].includes(direction ?? '')) {
    return res.status(400).json({
      success: false,
      error: 'userId and direction (up|down) are required',
    });
  }

  const result = commentService.vote(req.params.id, userId, direction as 'up' | 'down');
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── GET /comments/project/:projectId ─────────────────────────────────────────

router.get('/project/:projectId', (req: Request, res: Response) => {
  const { targetType, targetId, includeDeleted } = req.query as {
    targetType?: string;
    targetId?: string;
    includeDeleted?: string;
  };

  if (!targetType || !targetId) {
    return res.status(400).json({
      success: false,
      error: 'targetType and targetId query params are required',
    });
  }

  const result = commentService.listComments(
    req.params.projectId,
    targetType as CommentTargetType,
    targetId,
    { includeDeleted: includeDeleted === 'true' },
  );

  return res.json({ success: true, count: result.length, data: result });
});

// ── GET /comments/project/:projectId/activity ─────────────────────────────────

router.get('/project/:projectId/activity', (req: Request, res: Response) => {
  const { limit } = req.query as { limit?: string };
  const events = commentService.getActivityFeed(
    req.params.projectId,
    limit ? parseInt(limit) : 50,
  );
  return res.json({ success: true, count: events.length, data: events });
});

// ── GET /comments/project/:projectId/search ───────────────────────────────────

router.get('/project/:projectId/search', (req: Request, res: Response) => {
  const { q, limit } = req.query as { q?: string; limit?: string };
  if (!q) {
    return res.status(400).json({ success: false, error: 'q query param is required' });
  }

  const results = commentService.search(
    req.params.projectId,
    q,
    limit ? parseInt(limit) : 20,
  );

  return res.json({ success: true, count: results.length, data: results });
});

// ── GET /comments/notifications/:userId ──────────────────────────────────────

router.get('/notifications/:userId', (req: Request, res: Response) => {
  const { unreadOnly, limit } = req.query as { unreadOnly?: string; limit?: string };
  const notifs = commentService.getUserNotifications(req.params.userId, {
    unreadOnly: unreadOnly === 'true',
    limit: limit ? parseInt(limit) : 50,
  });
  return res.json({ success: true, count: notifs.length, data: notifs });
});

// ── POST /comments/notifications/:userId/read ────────────────────────────────

router.post('/notifications/:userId/read', (req: Request, res: Response) => {
  const { notificationIds } = req.body as { notificationIds?: string[] };
  const count = commentService.markNotificationsRead(req.params.userId, notificationIds);
  return res.json({ success: true, markedRead: count });
});

export default router;
