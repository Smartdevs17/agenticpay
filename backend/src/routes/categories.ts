/**
 * Payment Categories Routes — Issue #251
 * CRUD for categories, assignment, analytics, and trend data.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  createCategory,
  listCategories,
  getCategory,
  updateCategory,
  deleteCategory,
  assignCategory,
  removeAssignment,
  getPaymentCategories,
  autoAssignCategory,
  getCategoryAnalytics,
  getCategoryTrend,
} from '../services/categories.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../middleware/errorHandler.js';

export const categoriesRouter = Router();

const CategoryTypeValues = ['subscription', 'invoice', 'donation', 'refund', 'escrow', 'milestone', 'other'] as const;

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(CategoryTypeValues).optional(),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isDefault: z.boolean().optional(),
});

const AssignSchema = z.object({
  categoryId: z.string().uuid(),
  assignedBy: z.string().optional(),
});

const getTenantId = (req: Request): string =>
  String(req.headers['x-tenant-id'] ?? req.query.tenantId ?? 'default');

// ── Category CRUD ─────────────────────────────────────────────────────────────

categoriesRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = CreateSchema.safeParse(req.body);
    if (!body.success) throw new AppError(400, body.error.message, 'VALIDATION_ERROR');
    const cat = await createCategory(getTenantId(req), body.data);
    res.status(201).json(cat);
  })
);

categoriesRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const cats = await listCategories(getTenantId(req));
    res.json(cats);
  })
);

categoriesRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const cat = await getCategory(req.params.id);
    if (!cat) throw new AppError(404, 'Category not found', 'NOT_FOUND');
    res.json(cat);
  })
);

categoriesRouter.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const body = CreateSchema.partial().safeParse(req.body);
    if (!body.success) throw new AppError(400, body.error.message, 'VALIDATION_ERROR');
    const cat = await updateCategory(req.params.id, body.data as never);
    res.json(cat);
  })
);

categoriesRouter.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await deleteCategory(req.params.id);
    res.status(204).end();
  })
);

// ── Assignment ────────────────────────────────────────────────────────────────

categoriesRouter.post(
  '/payments/:paymentId/assign',
  asyncHandler(async (req: Request, res: Response) => {
    const body = AssignSchema.safeParse(req.body);
    if (!body.success) throw new AppError(400, body.error.message, 'VALIDATION_ERROR');
    const result = await assignCategory(req.params.paymentId, body.data.categoryId, body.data.assignedBy);
    res.status(201).json(result);
  })
);

categoriesRouter.post(
  '/payments/:paymentId/auto-assign',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await autoAssignCategory(getTenantId(req), req.params.paymentId, req.body ?? {});
    res.status(201).json(result);
  })
);

categoriesRouter.delete(
  '/payments/:paymentId/assign/:categoryId',
  asyncHandler(async (req: Request, res: Response) => {
    await removeAssignment(req.params.paymentId, req.params.categoryId);
    res.status(204).end();
  })
);

categoriesRouter.get(
  '/payments/:paymentId/categories',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await getPaymentCategories(req.params.paymentId);
    res.json(result);
  })
);

// ── Analytics ─────────────────────────────────────────────────────────────────

categoriesRouter.get(
  '/analytics/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const analytics = await getCategoryAnalytics(getTenantId(req), from, to);
    res.json(analytics);
  })
);

categoriesRouter.get(
  '/analytics/trend/:categoryId',
  asyncHandler(async (req: Request, res: Response) => {
    const trend = await getCategoryTrend(getTenantId(req), req.params.categoryId);
    res.json(trend);
  })
);
