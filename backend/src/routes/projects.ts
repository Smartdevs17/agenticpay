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
      const { projectId } = req.query;
      const alerts = projectsService.getOverdueMilestones(
        typeof projectId === 'string' ? projectId : undefined,
      );
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
