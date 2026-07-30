/**
 * project-archival.ts — automated project archival with data retention.
 *
 * Mounted at /api/v1/project-archival.  Kept separate from the projects
 * router so the collection paths do not collide with its "/:id" routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireEnhancedPermission } from '../middleware/permissions.js';
import { projectArchivalService } from '../services/project-archival/index.js';

export const projectArchivalRouter = Router();

const projectStatus = z.enum(['active', 'completed', 'archived', 'disputed', 'abandoned']);

const policySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  scope: z.enum(['global', 'client', 'owner']).optional(),
  scopeId: z.string().min(1).nullable().optional(),
  archiveAfterDays: z.number().int().min(0),
  purgeAfterDays: z.number().int().min(0),
  eligibleStatuses: z.array(projectStatus).optional(),
  enabled: z.boolean().optional(),
  notify: z.boolean().optional(),
});

const runSchema = z.object({
  dryRun: z.boolean().optional(),
});

const restoreSchema = z.object({
  restoredBy: z.string().min(1).optional(),
});

const archiveSchema = z.object({
  projectId: z.string().min(1),
  actor: z.string().min(1).optional(),
});

function actorOf(req: unknown): string | undefined {
  return (req as { user?: { id?: string } }).user?.id;
}

// ── Retention policies ──────────────────────────────────────────────────────

projectArchivalRouter.get(
  '/policies',
  requireEnhancedPermission('projects', 'read'),
  (_req, res, next) => {
    try {
      const policies = projectArchivalService.listPolicies();
      res.json({ policies, count: policies.length });
    } catch (err) { next(err); }
  },
);

projectArchivalRouter.post(
  '/policies',
  requireEnhancedPermission('projects', 'write'),
  validate(policySchema),
  (req, res) => {
    try {
      res.status(201).json(projectArchivalService.configurePolicy(req.body));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  },
);

projectArchivalRouter.delete(
  '/policies/:policyId',
  requireEnhancedPermission('projects', 'delete'),
  (req, res, next) => {
    try {
      const deleted = projectArchivalService.deletePolicy(String(req.params.policyId));
      if (!deleted) {
        res.status(400).json({ error: 'Policy not found or cannot be deleted' });
        return;
      }
      res.json({ deleted: true, policyId: req.params.policyId });
    } catch (err) { next(err); }
  },
);

// ── Archival sweep ──────────────────────────────────────────────────────────

projectArchivalRouter.get(
  '/candidates',
  requireEnhancedPermission('projects', 'read'),
  (_req, res, next) => {
    try {
      const candidates = projectArchivalService.previewArchival();
      res.json({ candidates, count: candidates.length });
    } catch (err) { next(err); }
  },
);

projectArchivalRouter.post(
  '/run',
  requireEnhancedPermission('projects', 'write'),
  validate(runSchema),
  (req, res, next) => {
    try {
      res.json(projectArchivalService.runArchival({ dryRun: Boolean(req.body?.dryRun) }));
    } catch (err) { next(err); }
  },
);

projectArchivalRouter.post(
  '/archive',
  requireEnhancedPermission('projects', 'write'),
  validate(archiveSchema),
  (req, res, next) => {
    try {
      const record = projectArchivalService.archiveNow(
        req.body.projectId,
        req.body.actor ?? actorOf(req),
      );
      if (!record) {
        res.status(404).json({ error: 'Project not found or already archived' });
        return;
      }
      res.status(201).json(record);
    } catch (err) { next(err); }
  },
);

// ── Archives, restoration, analytics, notifications ─────────────────────────

projectArchivalRouter.get(
  '/archives',
  requireEnhancedPermission('projects', 'read'),
  (req, res, next) => {
    try {
      const archives = projectArchivalService.listArchives({
        clientId: typeof req.query.clientId === 'string' ? req.query.clientId : undefined,
        ownerId: typeof req.query.ownerId === 'string' ? req.query.ownerId : undefined,
        policyId: typeof req.query.policyId === 'string' ? req.query.policyId : undefined,
        includeRestored: req.query.includeRestored === 'true',
        includePurged: req.query.includePurged === 'true',
      });
      res.json({ archives, count: archives.length });
    } catch (err) { next(err); }
  },
);

projectArchivalRouter.post(
  '/restore/:projectId',
  requireEnhancedPermission('projects', 'write'),
  validate(restoreSchema),
  (req, res, next) => {
    try {
      const restored = projectArchivalService.restoreProject(
        String(req.params.projectId),
        req.body?.restoredBy ?? actorOf(req),
      );
      if (!restored) {
        res.status(404).json({ error: 'No restorable archive found for this project' });
        return;
      }
      res.json(restored);
    } catch (err) { next(err); }
  },
);

projectArchivalRouter.get(
  '/analytics',
  requireEnhancedPermission('projects', 'read'),
  (_req, res, next) => {
    try {
      res.json(projectArchivalService.getAnalytics());
    } catch (err) { next(err); }
  },
);

projectArchivalRouter.get(
  '/notifications',
  requireEnhancedPermission('projects', 'read'),
  (req, res, next) => {
    try {
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const notifications = projectArchivalService.listNotifications(
        Number.isFinite(limit) ? limit : 50,
        projectId,
      );
      res.json({ notifications, count: notifications.length });
    } catch (err) { next(err); }
  },
);
