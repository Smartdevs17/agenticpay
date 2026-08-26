/**
 * projects.ts — Issue #366
 *
 * Project routes using controller-service-repository pattern
 */

import { Router } from "express";
import { container } from "../di/container.js";
import { requireEnhancedPermission } from "../middleware/permissions.js";
import { attachResponseHelpers } from "../middleware/responseFormatter.js";
import { projectsService } from "../services/projects.js";

export const projectsRouter = Router();

// Attach response helpers
projectsRouter.use(attachResponseHelpers);

const projectController = container.getProjectController();

// Create project
projectsRouter.post(
  "/",
  requireEnhancedPermission("projects", "write"),
  projectController.createProject,
);

// Overdue milestone alerts — must come before /:id to avoid param collision
projectsRouter.get(
  "/overdue-alerts",
  requireEnhancedPermission("projects", "read"),
  (req, res, next) => {
    try {
      const sessionUser = (req as typeof req & { user?: { id: string; role: string } }).user;
      const { projectId } = req.query;
      const targetProjectId = typeof projectId === 'string' ? projectId : undefined;
      // Scope to the caller's own projects unless they have admin role
      const ownerId = sessionUser?.role === 'admin' ? undefined : sessionUser?.id;
      const alerts = projectsService.getOverdueMilestones(targetProjectId, ownerId);
      res.json({ alerts, count: alerts.length });
    } catch (err) {
      next(err);
    }
  },
);

// List all projects
projectsRouter.get(
  "/",
  requireEnhancedPermission("projects", "read"),
  projectController.listProjects,
);

// Get single project
projectsRouter.get(
  "/:id",
  requireEnhancedPermission("projects", "read"),
  projectController.getProject,
);

// List client projects
projectsRouter.get(
  "/client/:clientId",
  requireEnhancedPermission("projects", "read"),
  projectController.listClientProjects,
);

// List freelancer projects
projectsRouter.get(
  "/freelancer/:freelancerId",
  requireEnhancedPermission("projects", "read"),
  projectController.listFreelancerProjects,
);

// Update project
projectsRouter.patch(
  "/:id",
  requireEnhancedPermission("projects", "write"),
  projectController.updateProject,
);

// Fund project
projectsRouter.post(
  "/:id/fund",
  requireEnhancedPermission("projects", "write"),
  projectController.fundProject,
);

// Submit work
projectsRouter.post(
  "/:id/submit",
  requireEnhancedPermission("projects", "write"),
  projectController.submitWork,
);

// Approve work
projectsRouter.post(
  "/:id/approve",
  requireEnhancedPermission("projects", "write"),
  projectController.approveWork,
);

// Raise dispute
projectsRouter.post(
  "/:id/dispute",
  requireEnhancedPermission("projects", "write"),
  projectController.raiseDispute,
);

// Delete project
projectsRouter.delete(
  "/:id",
  requireEnhancedPermission("projects", "delete"),
  projectController.deleteProject,
);

// ── Milestone Dependency Routes ─────────────────────────────────────────────

// GET /:id/dependencies — list all milestone dependencies
projectsRouter.get(
  "/:id/dependencies",
  requireEnhancedPermission("projects", "read"),
  (req, res, next) => {
    try {
      const projectId = String(req.params.id);
      const deps = projectsService.getDependencies(projectId);
      res.json({ dependencies: deps, count: deps.length });
    } catch (err) { next(err); }
  },
);

// GET /:id/dependencies/conflicts — detect dependency conflicts
projectsRouter.get(
  "/:id/dependencies/conflicts",
  requireEnhancedPermission("projects", "read"),
  (req, res, next) => {
    try {
      const projectId = String(req.params.id);
      const conflicts = projectsService.checkDependencyConflicts(projectId);
      res.json({ conflicts, hasConflicts: conflicts.length > 0 });
    } catch (err) { next(err); }
  },
);

// PATCH /:id/milestones/:milestoneId/dependencies — update milestone deps
import { z } from 'zod';
import { validate } from '../middleware/validate.js';

const updateDepsSchema = z.object({
  dependsOn: z.array(z.string()),
});

projectsRouter.patch(
  "/:id/milestones/:milestoneId/dependencies",
  requireEnhancedPermission("projects", "write"),
  validate(updateDepsSchema),
  (req, res, next) => {
    try {
      const projectId = String(req.params.id);
      const milestoneId = String(req.params.milestoneId);
      const { dependsOn } = req.body;
      const updated = projectsService.updateMilestoneDependencies(projectId, milestoneId, dependsOn);
      if (!updated) {
        res.status(404).json({ error: 'Milestone not found or invalid dependencies' });
        return;
      }
      res.json(updated);
    } catch (err) { next(err); }
  },
);

// ── Critical Path Routes ────────────────────────────────────────────────────

// GET /:id/critical-path — compute critical path
projectsRouter.get(
  "/:id/critical-path",
  requireEnhancedPermission("projects", "read"),
  (req, res, next) => {
    try {
      const projectId = String(req.params.id);
      const result = projectsService.computeCriticalPath(projectId);
      if (!result) {
        res.status(404).json({ error: 'No milestones found for project' });
        return;
      }
      res.json(result);
    } catch (err) { next(err); }
  },
);

// GET /:id/gantt — get Gantt data
projectsRouter.get(
  "/:id/gantt",
  requireEnhancedPermission("projects", "read"),
  (req, res, next) => {
    try {
      const projectId = String(req.params.id);
      const ganttData = projectsService.getGanttData(projectId);
      res.json({ items: ganttData, count: ganttData.length });
    } catch (err) { next(err); }
  },
);

// GET /:id/deadline-alerts — get deadline alerts
projectsRouter.get(
  "/:id/deadline-alerts",
  requireEnhancedPermission("projects", "read"),
  (req, res, next) => {
    try {
      const projectId = String(req.params.id);
      const { thresholdDays } = req.query;
      const threshold = typeof thresholdDays === 'string' ? parseInt(thresholdDays, 10) : 7;
      const sessionUser = (req as typeof req & { user?: { id: string; role: string } }).user;
      const ownerId = sessionUser?.role === 'admin' ? undefined : sessionUser?.id;
      const alerts = projectsService.getDeadlineAlerts(projectId, ownerId, threshold);
      res.json({ alerts, count: alerts.length });
    } catch (err) { next(err); }
  },
);

// POST /:id/milestones/:milestoneId/complete — cascade completion
projectsRouter.post(
  "/:id/milestones/:milestoneId/complete",
  requireEnhancedPermission("projects", "write"),
  (req, res, next) => {
    try {
      const projectId = String(req.params.id);
      const milestoneId = String(req.params.milestoneId);
      const cascaded = projectsService.cascadeMilestoneCompletion(projectId, milestoneId);
      res.json({ cascaded, count: cascaded.length });
    } catch (err) { next(err); }
  },
);
