/**
 * CategoriesController.ts — Issue #715
 *
 * HTTP layer for payment categories — request parsing, validation, and
 * response shaping only. Business logic lives in CategoriesService.
 */
import { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { CategoriesService, categoriesService } from '../services/categories.js';

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

export class CategoriesController {
  constructor(private readonly service: CategoriesService = categoriesService) {}

  createCategory = async (req: Request, res: Response): Promise<void> => {
    const body = CreateSchema.safeParse(req.body);
    if (!body.success) throw new AppError(400, body.error.message, 'VALIDATION_ERROR');
    const cat = await this.service.createCategory(getTenantId(req), body.data);
    res.status(201).json(cat);
  };

  listCategories = async (req: Request, res: Response): Promise<void> => {
    const cats = await this.service.listCategories(getTenantId(req));
    res.json(cats);
  };

  getCategory = async (req: Request, res: Response): Promise<void> => {
    const cat = await this.service.getCategory(req.params.id);
    if (!cat) throw new AppError(404, 'Category not found', 'NOT_FOUND');
    res.json(cat);
  };

  updateCategory = async (req: Request, res: Response): Promise<void> => {
    const body = CreateSchema.partial().safeParse(req.body);
    if (!body.success) throw new AppError(400, body.error.message, 'VALIDATION_ERROR');
    const cat = await this.service.updateCategory(req.params.id, body.data);
    res.json(cat);
  };

  deleteCategory = async (req: Request, res: Response): Promise<void> => {
    await this.service.deleteCategory(req.params.id);
    res.status(204).end();
  };

  assignCategory = async (req: Request, res: Response): Promise<void> => {
    const body = AssignSchema.safeParse(req.body);
    if (!body.success) throw new AppError(400, body.error.message, 'VALIDATION_ERROR');
    const result = await this.service.assignCategory(req.params.paymentId, body.data.categoryId, body.data.assignedBy);
    res.status(201).json(result);
  };

  autoAssignCategory = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.autoAssignCategory(getTenantId(req), req.params.paymentId, req.body ?? {});
    res.status(201).json(result);
  };

  removeAssignment = async (req: Request, res: Response): Promise<void> => {
    await this.service.removeAssignment(req.params.paymentId, req.params.categoryId);
    res.status(204).end();
  };

  getPaymentCategories = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.getPaymentCategories(req.params.paymentId);
    res.json(result);
  };

  getCategoryAnalytics = async (req: Request, res: Response): Promise<void> => {
    const analytics = await this.service.getCategoryAnalytics(getTenantId(req));
    res.json(analytics);
  };

  getCategoryTrend = async (req: Request, res: Response): Promise<void> => {
    const trend = await this.service.getCategoryTrend(getTenantId(req), req.params.categoryId);
    res.json(trend);
  };
}

export const categoriesController = new CategoriesController();
