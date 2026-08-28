/**
 * CategoryController.ts — Issue #715
 *
 * HTTP layer for payment categories — request parsing/validation and
 * response shaping only. Business logic lives in CategoryService.
 */

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { BaseController } from "./BaseController.js";
import { AppError } from "../middleware/errorHandler.js";
import { CategoryService } from "../services/CategoryService.js";

const CategoryTypeValues = ["subscription", "invoice", "donation", "refund", "escrow", "milestone", "other"] as const;

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

export class CategoryController extends BaseController {
  constructor(private categoryService: CategoryService) {
    super();
  }

  private getTenantId(req: Request): string {
    return String(req.headers["x-tenant-id"] ?? req.query.tenantId ?? "default");
  }

  createCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const body = CreateSchema.safeParse(req.body);
      if (!body.success) throw new AppError(400, body.error.message, "VALIDATION_ERROR");
      const category = await this.categoryService.createCategory(this.getTenantId(req), body.data);
      res.status(201).json(category);
    });
  };

  listCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const categories = await this.categoryService.listCategories(this.getTenantId(req));
      res.json(categories);
    });
  };

  getCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const category = await this.categoryService.getCategory(req.params.id);
      res.json(category);
    });
  };

  updateCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const body = CreateSchema.partial().safeParse(req.body);
      if (!body.success) throw new AppError(400, body.error.message, "VALIDATION_ERROR");
      const category = await this.categoryService.updateCategory(req.params.id, body.data);
      res.json(category);
    });
  };

  deleteCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      await this.categoryService.deleteCategory(req.params.id);
      res.status(204).end();
    });
  };

  assignCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const body = AssignSchema.safeParse(req.body);
      if (!body.success) throw new AppError(400, body.error.message, "VALIDATION_ERROR");
      const result = await this.categoryService.assignCategory(req.params.paymentId, body.data.categoryId, body.data.assignedBy);
      res.status(201).json(result);
    });
  };

  autoAssignCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const result = await this.categoryService.autoAssignCategory(this.getTenantId(req), req.params.paymentId, req.body ?? {});
      res.status(201).json(result);
    });
  };

  removeAssignment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      await this.categoryService.removeAssignment(req.params.paymentId, req.params.categoryId);
      res.status(204).end();
    });
  };

  getPaymentCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const result = await this.categoryService.getPaymentCategories(req.params.paymentId);
      res.json(result);
    });
  };

  getCategoryAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const from = req.query.from ? new Date(String(req.query.from)) : undefined;
      const to = req.query.to ? new Date(String(req.query.to)) : undefined;
      const analytics = await this.categoryService.getCategoryAnalytics(this.getTenantId(req), from, to);
      res.json(analytics);
    });
  };

  getCategoryTrend = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const trend = await this.categoryService.getCategoryTrend(this.getTenantId(req), req.params.categoryId);
      res.json(trend);
    });
  };
}
