/**
 * categories.ts (routes) — Issue #251 / #715
 *
 * Thin router wiring for payment categories — no business logic here.
 * Delegates to CategoryController (HTTP) → CategoryService (business logic)
 * → CategoryRepository (data access), matching the controller-service-
 * repository pattern established in Issue #366.
 */
import { Router } from 'express';
import { container } from '../di/container.js';

export const categoriesRouter = Router();

const categoryController = container.getCategoryController();

// ── Category CRUD ─────────────────────────────────────────────────────────────

categoriesRouter.post('/', categoryController.createCategory);
categoriesRouter.get('/', categoryController.listCategories);
categoriesRouter.get('/:id', categoryController.getCategory);
categoriesRouter.patch('/:id', categoryController.updateCategory);
categoriesRouter.delete('/:id', categoryController.deleteCategory);

// ── Assignment ────────────────────────────────────────────────────────────────

categoriesRouter.post('/payments/:paymentId/assign', categoryController.assignCategory);
categoriesRouter.post('/payments/:paymentId/auto-assign', categoryController.autoAssignCategory);
categoriesRouter.delete('/payments/:paymentId/assign/:categoryId', categoryController.removeAssignment);
categoriesRouter.get('/payments/:paymentId/categories', categoryController.getPaymentCategories);

// ── Analytics ─────────────────────────────────────────────────────────────────

categoriesRouter.get('/analytics/summary', categoryController.getCategoryAnalytics);
categoriesRouter.get('/analytics/trend/:categoryId', categoryController.getCategoryTrend);
