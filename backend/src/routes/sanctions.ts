/**
 * Sanctions screening API — Issue #923
 *
 * Endpoints:
 * - GET    /sanctions/lists              → loaded lists and watchlist size
 * - GET    /sanctions/entities           → list watchlist entries
 * - POST   /sanctions/entities           → add/replace a watchlist entry
 * - DELETE /sanctions/entities/:id       → remove a watchlist entry
 * - POST   /sanctions/screen             → screen a name/counterparty
 * - POST   /sanctions/screen/transaction → screen payer and payee together
 * - GET    /sanctions/history            → recent screening decisions
 * - POST   /sanctions/reload             → bulk-load list data (scheduled refresh)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  SanctionsEntityType,
  SanctionsListName,
  getScreeningHistory,
  getSanctionsEntity,
  getSanctionsListSize,
  listSanctionsEntities,
  loadSanctionsEntries,
  removeSanctionsEntity,
  screenEntity,
  screenTransaction,
  upsertSanctionsEntity,
} from '../services/sanctions/ofac-screening.js';

export const sanctionsScreeningRouter = Router();

const listNameSchema = z.enum(['OFAC_SDN', 'OFAC_CONSOLIDATED', 'EU', 'UN', 'UK_OFSI']);
const entityTypeSchema = z.enum(['individual', 'entity', 'vessel', 'aircraft']);

const querySchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  entityType: entityTypeSchema.optional(),
  countries: z.array(z.string()).optional(),
  dateOfBirth: z.string().optional(),
  nationalId: z.string().optional(),
});

const screeningOptionsSchema = z.object({
  threshold: z.number().min(0).max(1).optional(),
  potentialThreshold: z.number().min(0).max(1).optional(),
  lists: z.array(listNameSchema).optional(),
  maxResults: z.number().int().positive().max(100).optional(),
});

const entitySchema = z.object({
  id: z.string().min(1).optional(),
  list: listNameSchema,
  name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  entityType: entityTypeSchema,
  programs: z.array(z.string()).optional(),
  countries: z.array(z.string()).optional(),
  dateOfBirth: z.string().optional(),
  nationalIds: z.array(z.string()).optional(),
  remarks: z.string().optional(),
});

const screenRequestSchema = z.object({
  query: querySchema,
  options: screeningOptionsSchema.optional(),
});

const transactionScreenSchema = z.object({
  transactionId: z.string().optional(),
  payer: querySchema.optional(),
  payee: querySchema.optional(),
  options: screeningOptionsSchema.optional(),
});

const reloadSchema = z.object({
  entries: z.array(entitySchema.required({ id: true })),
  replace: z.boolean().optional(),
});

sanctionsScreeningRouter.get(
  '/lists',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        supportedLists: ['OFAC_SDN', 'OFAC_CONSOLIDATED', 'EU', 'UN', 'UK_OFSI'] satisfies SanctionsListName[],
        watchlistSize: getSanctionsListSize(),
      },
    });
  }),
);

sanctionsScreeningRouter.get(
  '/entities',
  asyncHandler(async (req: Request, res: Response) => {
    const list = req.query.list as SanctionsListName | undefined;
    const entityType = req.query.entityType as SanctionsEntityType | undefined;
    const country = req.query.country as string | undefined;
    const entities = listSanctionsEntities({ list, entityType, country });
    res.status(200).json({ success: true, data: entities });
  }),
);

sanctionsScreeningRouter.get(
  '/entities/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const entity = getSanctionsEntity(req.params.id);
    if (!entity) {
      res.status(404).json({ success: false, error: { message: 'Sanctions entity not found' } });
      return;
    }
    res.status(200).json({ success: true, data: entity });
  }),
);

sanctionsScreeningRouter.post(
  '/entities',
  validate(entitySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const entity = upsertSanctionsEntity(req.body);
    res.status(201).json({ success: true, data: entity });
  }),
);

sanctionsScreeningRouter.delete(
  '/entities/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const removed = removeSanctionsEntity(req.params.id);
    if (!removed) {
      res.status(404).json({ success: false, error: { message: 'Sanctions entity not found' } });
      return;
    }
    res.status(200).json({ success: true, data: { removed: true } });
  }),
);

sanctionsScreeningRouter.post(
  '/screen',
  validate(screenRequestSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { query, options } = req.body as z.infer<typeof screenRequestSchema>;
    const result = screenEntity(query, options);
    res.status(200).json({ success: true, data: result });
  }),
);

sanctionsScreeningRouter.post(
  '/screen/transaction',
  validate(transactionScreenSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { transactionId, payer, payee, options } = req.body as z.infer<typeof transactionScreenSchema>;
    if (!payer && !payee) {
      res.status(400).json({ success: false, error: { message: 'At least one of payer or payee is required' } });
      return;
    }
    const result = screenTransaction({ transactionId, payer, payee }, options);
    res.status(200).json({ success: true, data: result });
  }),
);

sanctionsScreeningRouter.get(
  '/history',
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as 'clear' | 'potential_match' | 'match' | undefined;
    const since = req.query.since as string | undefined;
    res.status(200).json({ success: true, data: getScreeningHistory({ status, since }) });
  }),
);

sanctionsScreeningRouter.post(
  '/reload',
  validate(reloadSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { entries, replace } = req.body as z.infer<typeof reloadSchema>;
    const loaded = loadSanctionsEntries(entries, { replace });
    res.status(200).json({ success: true, data: { loaded, watchlistSize: getSanctionsListSize() } });
  }),
);
