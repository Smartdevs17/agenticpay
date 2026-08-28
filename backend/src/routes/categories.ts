/**
 * Payment Categories Routes — Issue #251 / #715
 * CRUD for categories, assignment, analytics, and trend data.
 *
 * Thin router — HTTP wiring only. Request handling lives in
 * CategoriesController, business logic in CategoriesService, data access in
 * CategoryRepository.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { categoriesController } from '../controllers/CategoriesController.js';

export const categoriesRouter = Router();

// ── Category CRUD ─────────────────────────────────────────────────────────────

categoriesRouter.post('/', asyncHandler(categoriesController.createCategory));
categoriesRouter.get('/', asyncHandler(categoriesController.listCategories));
categoriesRouter.get('/:id', asyncHandler(categoriesController.getCategory));
categoriesRouter.patch('/:id', asyncHandler(categoriesController.updateCategory));
categoriesRouter.delete('/:id', asyncHandler(categoriesController.deleteCategory));

// ── Assignment ────────────────────────────────────────────────────────────────

categoriesRouter.post('/payments/:paymentId/assign', asyncHandler(categoriesController.assignCategory));
categoriesRouter.post('/payments/:paymentId/auto-assign', asyncHandler(categoriesController.autoAssignCategory));
categoriesRouter.delete('/payments/:paymentId/assign/:categoryId', asyncHandler(categoriesController.removeAssignment));
categoriesRouter.get('/payments/:paymentId/categories', asyncHandler(categoriesController.getPaymentCategories));

// ── Analytics ─────────────────────────────────────────────────────────────────

categoriesRouter.get('/analytics/summary', asyncHandler(categoriesController.getCategoryAnalytics));
categoriesRouter.get('/analytics/trend/:categoryId', asyncHandler(categoriesController.getCategoryTrend));
