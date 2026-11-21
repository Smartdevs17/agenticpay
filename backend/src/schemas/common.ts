import { z } from 'zod';

/**
 * Shared query parameter schemas for paginated list endpoints.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const windowQuerySchema = z.object({
  windowMs: z.coerce.number().int().positive().max(86_400_000).default(60_000),
});

export const idParamSchema = z.object({
  id: z.string().min(1).max(128),
});

export const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

export default {
  paginationQuerySchema,
  windowQuerySchema,
  idParamSchema,
  uuidParamSchema,
};
