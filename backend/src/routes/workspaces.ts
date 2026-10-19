import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { asyncHandler } from '../middleware/errorHandler.js';
import { prisma } from '../config/database.js';

export const workspacesRouter = Router();

interface WorkspaceRequest extends Request {
  tenantId?: string;
}

workspacesRouter.post('/', asyncHandler(async (req: WorkspaceRequest, res: Response) => {
  const { name, description, type = 'standard' } = req.body;

  if (!name) {
    res.status(400).json({ error: 'Workspace name is required' });
    return;
  }

  const workspaceId = randomUUID();
  const metadata = {
    type,
    createdBy: req.tenantId,
    createdAt: new Date().toISOString(),
  };

  res.status(201).json({
    id: workspaceId,
    name,
    description,
    type,
    metadata,
  });
}));

workspacesRouter.get('/', asyncHandler(async (req: WorkspaceRequest, res: Response) => {
  const { limit = '50', offset = '0' } = req.query;

  const projects = await prisma.project.findMany({
    where: { tenantId: req.tenantId },
    take: Math.min(Number(limit), 100),
    skip: Number(offset),
    orderBy: { createdAt: 'desc' },
  });

  const total = await prisma.project.count({ where: { tenantId: req.tenantId } });

  res.status(200).json({
    total,
    limit: Number(limit),
    offset: Number(offset),
    workspaces: projects.map(p => ({
      id: p.id,
      name: p.title,
      description: p.description,
      status: p.status,
      createdAt: p.createdAt,
    })),
  });
}));

workspacesRouter.get('/:workspaceId', asyncHandler(async (req: WorkspaceRequest, res: Response) => {
  const { workspaceId } = req.params;

  const workspace = await prisma.project.findFirst({
    where: { id: workspaceId, tenantId: req.tenantId },
    include: { milestones: true, payments: true },
  });

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  res.status(200).json({
    id: workspace.id,
    name: workspace.title,
    description: workspace.description,
    status: workspace.status,
    totalAmount: workspace.totalAmount,
    currency: workspace.currency,
    clientAddress: workspace.clientAddress,
    freelancerAddress: workspace.freelancerAddress,
    milestonesCount: workspace.milestones.length,
    paymentsCount: workspace.payments.length,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  });
}));

workspacesRouter.put('/:workspaceId', asyncHandler(async (req: WorkspaceRequest, res: Response) => {
  const { workspaceId } = req.params;
  const { name, description, status } = req.body;

  const workspace = await prisma.project.findFirst({
    where: { id: workspaceId, tenantId: req.tenantId },
  });

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const updated = await prisma.project.update({
    where: { id: workspaceId },
    data: {
      ...(name && { title: name }),
      ...(description && { description }),
      ...(status && { status: status as any }),
      updatedAt: new Date(),
    },
  });

  res.status(200).json({
    id: updated.id,
    name: updated.title,
    description: updated.description,
    status: updated.status,
    updatedAt: updated.updatedAt,
  });
}));

workspacesRouter.get('/:workspaceId/members', asyncHandler(async (req: WorkspaceRequest, res: Response) => {
  const { workspaceId } = req.params;

  const workspace = await prisma.project.findFirst({
    where: { id: workspaceId, tenantId: req.tenantId },
  });

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  res.status(200).json({
    workspaceId,
    members: [
      {
        address: workspace.clientAddress,
        role: 'client',
        joinedAt: workspace.createdAt,
      },
      {
        address: workspace.freelancerAddress,
        role: 'freelancer',
        joinedAt: workspace.createdAt,
      },
    ],
  });
}));
