import type { Request, Response } from "express";
import { asyncHandler, AppError } from "../src/middleware/errorHandler.js";
import { disputeService } from "./disputeService.js";
import type { CreateDisputeDto, ResolutionOutcome } from "./disputeModel.js";

function requireUser(req: Request): { id: string; tenantId: string; role: string } {
  if (!req.user) {
    throw new AppError(401, "Authentication required", "UNAUTHORIZED");
  }
  return req.user;
}

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const dto = req.body as CreateDisputeDto;
  const data = await disputeService.create(dto, user.id, user.tenantId);
  res.status(201).json(data);
});

export const respond = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = await disputeService.respond(req.params.id, user.tenantId, user.id, req.body.content);
  res.json(data);
});

export const uploadEvidence = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  if (!req.file) {
    throw new AppError(400, "A file is required", "DISPUTE_EVIDENCE_FILE_REQUIRED");
  }

  const data = await disputeService.addEvidence(req.params.id, user.tenantId, user.id, {
    url: `/uploads/${req.file.originalname}`,
    name: req.file.originalname,
    size: req.file.size,
    description: req.body.description,
  });

  res.status(201).json(data);
});

export const resolve = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const payload = req.body as { outcome: ResolutionOutcome; resolutionNote: string; refundAmount?: number };
  const data = await disputeService.resolve(req.params.id, user.tenantId, user, payload);
  res.json(data);
});

export const getAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = await disputeService.getAnalytics(user.tenantId);
  res.json(data);
});
