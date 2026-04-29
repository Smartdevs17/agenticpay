import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  addMilestoneSchema,
  approveDeliverableSchema,
  createProjectSchema,
  disputeDeliverableSchema,
  scopeChangeSchema,
  submitDeliverableSchema,
  updateProjectSchema,
} from '../schemas/projects.js';
import { projectsService } from '../services/projects.js';

export const projectsRouter = Router();

projectsRouter.post(
  '/',
  validate(createProjectSchema),
  asyncHandler(async (req, res) => {
    const project = projectsService.createProject(req.body);
    res.status(201).json({ data: project });
  })
);

projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const projects = projectsService.listProjects({
      clientId: req.query.clientId ? String(req.query.clientId) : undefined,
      ownerId: req.query.ownerId ? String(req.query.ownerId) : undefined,
      includeArchived: String(req.query.includeArchived || 'false').toLowerCase() === 'true',
    });
    res.json({ data: projects, count: projects.length });
  })
);

projectsRouter.get(
  '/client/:clientId/review',
  asyncHandler(async (req, res) => {
    const clientId = Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId;
    const review = projectsService.getClientReviewPortal(clientId);
    res.json({ data: review, count: review.length });
  })
);

projectsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const project = projectsService.getProject(id);
    if (!project) {
      throw new AppError(404, 'Project not found', 'NOT_FOUND');
    }

    res.json({
      data: project,
      milestones: projectsService.listMilestones(id),
      releases: projectsService.getReleases(id),
    });
  })
);

projectsRouter.patch(
  '/:id',
  validate(updateProjectSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const project = projectsService.updateProject(id, req.body);
    if (!project) {
      throw new AppError(404, 'Project not found', 'NOT_FOUND');
    }
    res.json({ data: project });
  })
);

projectsRouter.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const project = projectsService.archiveProject(id);
    if (!project) {
      throw new AppError(404, 'Project not found', 'NOT_FOUND');
    }
    res.json({ data: project });
  })
);

projectsRouter.post(
  '/:id/abandon',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const project = projectsService.markAbandoned(id);
    if (!project) {
      throw new AppError(404, 'Project not found', 'NOT_FOUND');
    }
    res.json({ data: project });
  })
);

projectsRouter.post(
  '/:id/scope-change',
  validate(scopeChangeSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const project = projectsService.applyScopeChange(id, req.body.additionalBudget);
    if (!project) {
      throw new AppError(404, 'Project not found', 'NOT_FOUND');
    }
    res.json({
      data: project,
      scopeChange: {
        additionalBudget: req.body.additionalBudget,
        reason: req.body.reason,
      },
    });
  })
);

projectsRouter.post(
  '/:id/milestones',
  validate(addMilestoneSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const milestone = projectsService.addMilestone(id, req.body);
    if (!milestone) {
      throw new AppError(404, 'Project not found', 'NOT_FOUND');
    }
    res.status(201).json({ data: milestone });
  })
);

projectsRouter.get(
  '/:id/milestones',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const project = projectsService.getProject(id);
    if (!project) {
      throw new AppError(404, 'Project not found', 'NOT_FOUND');
    }
    const milestones = projectsService.listMilestones(id);
    res.json({ data: milestones, count: milestones.length });
  })
);

projectsRouter.post(
  '/:id/milestones/:milestoneId/submit',
  validate(submitDeliverableSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const milestoneId = Array.isArray(req.params.milestoneId) ? req.params.milestoneId[0] : req.params.milestoneId;
    const milestone = projectsService.submitDeliverable(id, milestoneId, req.body.submissionUrl, req.body.notes);
    if (!milestone) {
      throw new AppError(404, 'Milestone not found', 'NOT_FOUND');
    }
    res.json({ data: milestone });
  })
);

projectsRouter.post(
  '/:id/milestones/:milestoneId/approve',
  validate(approveDeliverableSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const milestoneId = Array.isArray(req.params.milestoneId) ? req.params.milestoneId[0] : req.params.milestoneId;

    const result = projectsService.approveDeliverable(id, milestoneId, req.body.approvedBy);
    if (!result) {
      throw new AppError(404, 'Milestone not found', 'NOT_FOUND');
    }
    res.json({ data: result.milestone, paymentRelease: result.release });
  })
);

projectsRouter.post(
  '/:id/milestones/:milestoneId/dispute',
  validate(disputeDeliverableSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const milestoneId = Array.isArray(req.params.milestoneId) ? req.params.milestoneId[0] : req.params.milestoneId;
    const milestone = projectsService.disputeMilestone(id, milestoneId, req.body.reason);
    if (!milestone) {
      throw new AppError(404, 'Milestone not found', 'NOT_FOUND');
    }
    res.json({
      data: milestone,
      project: projectsService.getProject(id),
    });
  })
);

projectsRouter.get(
  '/:id/dashboard',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const dashboard = projectsService.getDashboard(id);
    if (!dashboard) {
      throw new AppError(404, 'Project not found', 'NOT_FOUND');
    }
    res.json({ data: dashboard });
  })
);