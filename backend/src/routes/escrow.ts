import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { escrowService } from '../services/escrow.js';
import {
  createEscrowSchema,
  fundEscrowSchema,
  escrowMilestoneActionSchema,
  escrowSubmissionSchema,
} from '../schemas/index.js';

export const escrowRouter = Router();

escrowRouter.post(
  '/',
  validate(createEscrowSchema),
  asyncHandler(async (req, res) => {
    const { projectId, payerId, payeeId, currency, totalAmount, milestones, metadata } = req.body;

    const escrow = escrowService.createEscrow({
      projectId,
      payerId,
      payeeId,
      currency,
      totalAmount,
      milestones,
      metadata,
    });

    res.status(201).json(escrow);
  })
);

escrowRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(escrowService.listEscrows());
  })
);

escrowRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const escrow = escrowService.getEscrow(id);
    if (!escrow) {
      throw new AppError(404, 'Escrow agreement not found', 'NOT_FOUND');
    }
    res.json(escrow);
  })
);

escrowRouter.post(
  '/:id/fund',
  validate(fundEscrowSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { amount } = req.body;
    const escrow = escrowService.fundEscrow(id, amount);
    if (!escrow) {
      throw new AppError(404, 'Escrow agreement not found', 'NOT_FOUND');
    }
    res.json(escrow);
  })
);

escrowRouter.post(
  '/:id/milestone/:milestoneId/submit',
  validate(escrowSubmissionSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const milestoneId = Array.isArray(req.params.milestoneId) ? req.params.milestoneId[0] : req.params.milestoneId;
    const { submissionUrl, notes } = req.body;
    const milestone = escrowService.submitMilestone(id, milestoneId, submissionUrl, notes);
    if (!milestone) {
      throw new AppError(404, 'Escrow milestone not found or invalid state', 'NOT_FOUND');
    }
    res.json(milestone);
  })
);

escrowRouter.post(
  '/:id/milestone/:milestoneId/approve',
  validate(escrowMilestoneActionSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const milestoneId = Array.isArray(req.params.milestoneId) ? req.params.milestoneId[0] : req.params.milestoneId;
    const { approvedBy } = req.body;
    const result = escrowService.approveMilestone(id, milestoneId, approvedBy);
    if (!result) {
      throw new AppError(404, 'Escrow milestone not found or not ready for approval', 'NOT_FOUND');
    }
    res.json(result);
  })
);

escrowRouter.post(
  '/:id/milestone/:milestoneId/dispute',
  validate(escrowMilestoneActionSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const milestoneId = Array.isArray(req.params.milestoneId) ? req.params.milestoneId[0] : req.params.milestoneId;
    const { reason } = req.body;
    const milestone = escrowService.disputeMilestone(id, milestoneId, reason);
    if (!milestone) {
      throw new AppError(404, 'Escrow milestone not found or cannot be disputed', 'NOT_FOUND');
    }
    res.json(milestone);
  })
);
