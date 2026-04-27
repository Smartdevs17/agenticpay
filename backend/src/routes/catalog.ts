import { Router } from 'express';
import { getCatalog } from '../services/catalog.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';

export const catalogRouter = Router();

// Catalog data is static — cache for 5 minutes (CDN-friendly)
catalogRouter.get(
  '/',
  cacheControl({ maxAge: CacheTTL.STATIC, staleWhileRevalidate: 60 }),
  asyncHandler(async (_req, res) => {
    const catalog = getCatalog();
    res.json(catalog);
  })
);
