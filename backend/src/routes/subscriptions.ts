import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { prisma } from '../config/database.js';

export const subscriptionsRouter = Router();

subscriptionsRouter.get('/export/csv', asyncHandler(async (req: Request, res: Response) => {
  const { merchantId, startDate, endDate } = req.query;

  const whereClause: any = {};
  if (merchantId) whereClause.merchantId = merchantId as string;
  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate as string);
    if (endDate) whereClause.createdAt.lte = new Date(endDate as string);
  }

  const subscriptions = await prisma.paymentLink.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
  });

  const headers = ['ID', 'Merchant ID', 'Amount', 'Currency', 'Status', 'Created At', 'Updated At'];
  const rows = subscriptions.map(s => [
    s.id,
    s.merchantId,
    s.amount?.toString() || 'N/A',
    s.currency,
    s.status,
    s.createdAt.toISOString(),
    s.updatedAt.toISOString(),
  ]);

  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="subscriptions-${Date.now()}.csv"`);
  res.status(200).send(csv);
}));

subscriptionsRouter.get('/export/json', asyncHandler(async (req: Request, res: Response) => {
  const { merchantId, startDate, endDate } = req.query;

  const whereClause: any = {};
  if (merchantId) whereClause.merchantId = merchantId as string;
  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate as string);
    if (endDate) whereClause.createdAt.lte = new Date(endDate as string);
  }

  const subscriptions = await prisma.paymentLink.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
  });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="subscriptions-${Date.now()}.json"`);
  res.status(200).json({
    total: subscriptions.length,
    data: subscriptions,
    exportedAt: new Date().toISOString(),
  });
}));

subscriptionsRouter.get('/:merchantId', asyncHandler(async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { limit = '50', offset = '0' } = req.query;

  const subscriptions = await prisma.paymentLink.findMany({
    where: { merchantId },
    take: Math.min(Number(limit), 100),
    skip: Number(offset),
    orderBy: { createdAt: 'desc' },
  });

  const total = await prisma.paymentLink.count({ where: { merchantId } });

  res.status(200).json({
    total,
    limit: Number(limit),
    offset: Number(offset),
    data: subscriptions,
  });
}));

subscriptionsRouter.get('/:merchantId/analytics', asyncHandler(async (req: Request, res: Response) => {
  const { merchantId } = req.params;

  const subscriptions = await prisma.paymentLink.findMany({
    where: { merchantId },
  });

  const active = subscriptions.filter(s => s.status === 'active').length;
  const expired = subscriptions.filter(s => s.status === 'expired').length;
  const used = subscriptions.filter(s => s.status === 'used').length;

  const totalRevenue = subscriptions
    .filter(s => s.amount && s.status === 'used')
    .reduce((sum, s) => sum + Number(s.amount || 0), 0);

  res.status(200).json({
    merchantId,
    totalSubscriptions: subscriptions.length,
    activeLinks: active,
    expiredLinks: expired,
    usedLinks: used,
    totalRevenue,
    byStatus: {
      active,
      expired,
      used,
      disabled: subscriptions.filter(s => s.status === 'disabled').length,
    },
  });
}));
