import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { milestoneDependencyService } from '../services/milestones.js';
import { projectsService } from '../services/projects.js';
import { z } from 'zod';

export const milestonesRouter = Router();

const addDependencySchema = z.object({
  milestoneId: z.string().min(1),
  dependsOnMilestoneId: z.string().min(1),
});

milestonesRouter.get(
  '/:projectId/dependencies',
  asyncHandler(async (req, res) => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const deps = milestoneDependencyService.getAllDependencies(projectId);
    res.json({ data: deps, count: deps.length });
  })
);

milestonesRouter.get(
  '/:projectId/graph',
  asyncHandler(async (req, res) => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const project = projectsService.getProject(projectId);
    if (!project) throw new AppError(404, 'Project not found', 'NOT_FOUND');

    const milestones = projectsService.listMilestones(projectId);
    const graph = milestoneDependencyService.buildDependencyGraph(
      projectId,
      milestones.map((m) => ({ id: m.id, title: m.title, status: m.status, dueDate: m.dueDate }))
    );

    res.json({ data: graph });
  })
);

milestonesRouter.get(
  '/:projectId/blocked',
  asyncHandler(async (req, res) => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const blockedIds = milestoneDependencyService.getBlockedMilestones(projectId);
    res.json({ data: blockedIds });
  })
);

milestonesRouter.post(
  '/:projectId/dependencies',
  validate(addDependencySchema),
  asyncHandler(async (req, res) => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const project = projectsService.getProject(projectId);
    if (!project) throw new AppError(404, 'Project not found', 'NOT_FOUND');

    const result = milestoneDependencyService.addDependency(projectId, req.body);
    if ('error' in result) {
      throw new AppError(400, result.error, 'VALIDATION_ERROR');
    }

    res.status(201).json({ data: result });
  })
);

milestonesRouter.delete(
  '/dependencies/:dependencyId',
  asyncHandler(async (req, res) => {
    const dependencyId = Array.isArray(req.params.dependencyId) ? req.params.dependencyId[0] : req.params.dependencyId;
    const deleted = milestoneDependencyService.deleteDependency(dependencyId);
    if (!deleted) throw new AppError(404, 'Dependency not found', 'NOT_FOUND');
    res.status(204).send();
  })
);

milestonesRouter.post(
  '/:projectId/milestones/:milestoneId/complete-dependencies',
  asyncHandler(async (req, res) => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const milestoneId = Array.isArray(req.params.milestoneId) ? req.params.milestoneId[0] : req.params.milestoneId;
    const unblocked = milestoneDependencyService.markDependencyComplete(projectId, milestoneId);
    res.json({ data: unblocked, count: unblocked.length });
  })
);
