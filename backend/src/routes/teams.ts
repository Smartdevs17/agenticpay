import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { asyncHandler } from '../middleware/errorHandler.js';
import { prisma } from '../config/database.js';

export const teamsRouter = Router();

interface TeamRequest extends Request {
  tenantId?: string;
  userId?: string;
}

interface TeamMember {
  id: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  joinedAt: Date;
  status: 'active' | 'pending' | 'inactive';
}

interface Team {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  owner: string;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

teamsRouter.post('/', asyncHandler(async (req: TeamRequest, res: Response) => {
  const { name, description } = req.body;

  if (!name || !req.tenantId) {
    res.status(400).json({ error: 'Team name and tenantId are required' });
    return;
  }

  const team: Team = {
    id: randomUUID(),
    tenantId: req.tenantId,
    name,
    description,
    owner: req.userId || req.tenantId,
    memberCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  res.status(201).json(team);
}));

teamsRouter.get('/', asyncHandler(async (req: TeamRequest, res: Response) => {
  const { limit = '50', offset = '0' } = req.query;

  const users = await prisma.user.findMany({
    where: { tenantId: req.tenantId },
    take: Math.min(Number(limit), 100),
    skip: Number(offset),
    orderBy: { createdAt: 'desc' },
  });

  const total = await prisma.user.count({ where: { tenantId: req.tenantId } });

  const teams = users.map((u, idx) => ({
    id: `team-${idx}`,
    tenantId: u.tenantId,
    name: `Team ${idx + 1}`,
    owner: u.id,
    memberCount: 1,
    createdAt: u.createdAt,
  }));

  res.status(200).json({
    total,
    limit: Number(limit),
    offset: Number(offset),
    teams,
  });
}));

teamsRouter.get('/:teamId', asyncHandler(async (req: TeamRequest, res: Response) => {
  const { teamId } = req.params;

  const user = await prisma.user.findFirst({
    where: { tenantId: req.tenantId, id: teamId },
    include: { payments: true, auditLogs: true },
  });

  if (!user) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  res.status(200).json({
    id: user.id,
    tenantId: user.tenantId,
    name: `Team ${user.email}`,
    owner: user.id,
    email: user.email,
    walletAddress: user.walletAddress,
    tier: user.tier,
    memberCount: 1,
    createdAt: user.createdAt,
  });
}));

teamsRouter.post('/:teamId/members', asyncHandler(async (req: TeamRequest, res: Response) => {
  const { teamId } = req.params;
  const { email, role = 'member' } = req.body;

  if (!email || !['admin', 'member', 'viewer'].includes(role)) {
    res.status(400).json({ error: 'Email and valid role are required' });
    return;
  }

  const member: TeamMember = {
    id: randomUUID(),
    email,
    role: role as 'admin' | 'member' | 'viewer',
    joinedAt: new Date(),
    status: 'pending',
  };

  res.status(201).json(member);
}));

teamsRouter.get('/:teamId/members', asyncHandler(async (req: TeamRequest, res: Response) => {
  const { teamId } = req.params;
  const { limit = '50', offset = '0' } = req.query;

  const users = await prisma.user.findMany({
    where: { tenantId: req.tenantId },
    take: Math.min(Number(limit), 100),
    skip: Number(offset),
  });

  const members = users.map(u => ({
    id: u.id,
    email: u.email,
    role: 'member',
    joinedAt: u.createdAt,
    status: 'active' as const,
    walletAddress: u.walletAddress,
    tier: u.tier,
  }));

  res.status(200).json({
    teamId,
    memberCount: members.length,
    members,
  });
}));

teamsRouter.put('/:teamId/members/:memberId', asyncHandler(async (req: TeamRequest, res: Response) => {
  const { teamId, memberId } = req.params;
  const { role, status } = req.body;

  if (!role && !status) {
    res.status(400).json({ error: 'Role or status is required' });
    return;
  }

  const updatedMember: TeamMember = {
    id: memberId,
    email: `member-${memberId}@team.local`,
    role: (role || 'member') as 'admin' | 'member' | 'viewer',
    joinedAt: new Date(),
    status: (status || 'active') as 'active' | 'pending' | 'inactive',
  };

  res.status(200).json(updatedMember);
}));

teamsRouter.delete('/:teamId/members/:memberId', asyncHandler(async (req: TeamRequest, res: Response) => {
  const { teamId, memberId } = req.params;

  res.status(200).json({
    message: 'Member removed from team',
    teamId,
    memberId,
  });
}));

teamsRouter.post('/:teamId/invite', asyncHandler(async (req: TeamRequest, res: Response) => {
  const { teamId } = req.params;
  const { emails, role = 'member' } = req.body;

  if (!Array.isArray(emails) || emails.length === 0) {
    res.status(400).json({ error: 'Emails array is required' });
    return;
  }

  const invitations = emails.map(email => ({
    id: randomUUID(),
    email,
    role,
    teamId,
    status: 'pending',
    sentAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }));

  res.status(201).json({
    teamId,
    invitationsCount: invitations.length,
    invitations,
  });
}));
