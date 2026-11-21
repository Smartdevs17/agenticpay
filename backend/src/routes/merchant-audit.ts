import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { prisma } from '../config/database.js';

export const merchantAuditRouter = Router();

interface MerchantAuditRequest extends Request {
  tenantId?: string;
}

merchantAuditRouter.get('/merchants/:merchantId/audit', asyncHandler(async (req: MerchantAuditRequest, res: Response) => {
  const { merchantId } = req.params;
  const { startDate, endDate, action, limit = '50', offset = '0' } = req.query;

  const whereClause: any = {
    entityId: merchantId,
    entityType: 'merchant',
  };

  if (action) whereClause.action = action as string;
  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate as string);
    if (endDate) whereClause.createdAt.lte = new Date(endDate as string);
  }

  const entries = await prisma.auditLog.findMany({
    where: whereClause,
    take: Math.min(Number(limit), 100),
    skip: Number(offset),
    orderBy: { createdAt: 'desc' },
    include: { user: true },
  });

  const total = await prisma.auditLog.count({ where: whereClause });

  res.status(200).json({
    merchantId,
    total,
    limit: Number(limit),
    offset: Number(offset),
    entries: entries.map(e => ({
      id: e.id,
      action: e.action,
      userId: e.userId,
      userEmail: e.user?.email,
      ipAddress: e.ipAddress,
      metadata: e.metadata,
      createdAt: e.createdAt,
    })),
  });
}));

merchantAuditRouter.get('/merchants/:merchantId/audit/:entryId', asyncHandler(async (req: MerchantAuditRequest, res: Response) => {
  const { merchantId, entryId } = req.params;

  const entry = await prisma.auditLog.findFirst({
    where: { id: entryId, entityId: merchantId, entityType: 'merchant' },
    include: { user: true },
  });

  if (!entry) {
    res.status(404).json({ error: 'Audit entry not found' });
    return;
  }

  res.status(200).json({
    id: entry.id,
    entityId: entry.entityId,
    entityType: entry.entityType,
    action: entry.action,
    userId: entry.userId,
    userEmail: entry.user?.email,
    ipAddress: entry.ipAddress,
    metadata: entry.metadata,
    createdAt: entry.createdAt,
  });
}));

merchantAuditRouter.get('/merchants/:merchantId/audit/export/csv', asyncHandler(async (req: MerchantAuditRequest, res: Response) => {
  const { merchantId } = req.params;
  const { startDate, endDate } = req.query;

  const whereClause: any = {
    entityId: merchantId,
    entityType: 'merchant',
  };

  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate as string);
    if (endDate) whereClause.createdAt.lte = new Date(endDate as string);
  }

  const entries = await prisma.auditLog.findMany({
    where: whereClause,
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  });

  const headers = ['ID', 'Action', 'User Email', 'IP Address', 'Created At', 'Metadata'];
  const rows = entries.map(e => [
    e.id,
    e.action,
    e.user?.email || 'N/A',
    e.ipAddress || 'N/A',
    e.createdAt.toISOString(),
    JSON.stringify(e.metadata || {}),
  ]);

  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="merchant-audit-${merchantId}-${Date.now()}.csv"`);
  res.status(200).send(csv);
}));

merchantAuditRouter.get('/merchants/:merchantId/audit/export/json', asyncHandler(async (req: MerchantAuditRequest, res: Response) => {
  const { merchantId } = req.params;
  const { startDate, endDate } = req.query;

  const whereClause: any = {
    entityId: merchantId,
    entityType: 'merchant',
  };

  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate as string);
    if (endDate) whereClause.createdAt.lte = new Date(endDate as string);
  }

  const entries = await prisma.auditLog.findMany({
    where: whereClause,
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="merchant-audit-${merchantId}-${Date.now()}.json"`);
  res.status(200).json({
    merchantId,
    total: entries.length,
    entries: entries.map(e => ({
      id: e.id,
      action: e.action,
      userId: e.userId,
      userEmail: e.user?.email,
      ipAddress: e.ipAddress,
      metadata: e.metadata,
      createdAt: e.createdAt,
    })),
    exportedAt: new Date().toISOString(),
  });
}));

merchantAuditRouter.get('/merchants/:merchantId/audit/summary', asyncHandler(async (req: MerchantAuditRequest, res: Response) => {
  const { merchantId } = req.params;
  const { days = '30' } = req.query;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Number(days));

  const entries = await prisma.auditLog.findMany({
    where: {
      entityId: merchantId,
      entityType: 'merchant',
      createdAt: { gte: startDate },
    },
    include: { user: true },
  });

  const actionCounts = entries.reduce((acc: any, e) => {
    acc[e.action] = (acc[e.action] || 0) + 1;
    return acc;
  }, {});

  const userActivity = entries.reduce((acc: any, e) => {
    const email = e.user?.email || 'unknown';
    acc[email] = (acc[email] || 0) + 1;
    return acc;
  }, {});

  res.status(200).json({
    merchantId,
    period: `${Number(days)} days`,
    totalEvents: entries.length,
    uniqueUsers: Object.keys(userActivity).length,
    actionBreakdown: actionCounts,
    userActivity,
    dateRange: {
      from: startDate.toISOString(),
      to: new Date().toISOString(),
    },
  });
}));
