import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import {
  createGdprRequest,
  getGdprRequest,
  listGdprRequests,
  updateGdprRequestStatus,
  eraseUserData,
  exportUserData,
  recordConsent,
  getUserConsents,
  listThirdPartyProcessors,
  listRetentionPolicies,
  getAuditLog,
} from '../services/gdpr.js';
import type { ConsentPurpose, GdprRequestType } from '../types/gdpr.js';

export const gdprRouter = Router();

const GDPR_REQUEST_TYPES: GdprRequestType[] = ['erasure', 'portability', 'notification', 'consent', 'restriction'];
const CONSENT_PURPOSES: ConsentPurpose[] = [
  'analytics',
  'marketing',
  'payment_processing',
  'service_delivery',
  'third_party_sharing',
];

// POST /api/v1/gdpr/requests - Submit a GDPR data subject request
gdprRouter.post(
  '/requests',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      userId: z.string().min(1),
      type: z.enum(GDPR_REQUEST_TYPES as [GdprRequestType, ...GdprRequestType[]]),
      requestedBy: z.string().min(1),
      notes: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Invalid request body', 'VALIDATION_ERROR', parsed.error.flatten());
    }

    const { userId, type, requestedBy, notes } = parsed.data;
    const request = createGdprRequest(userId, type, requestedBy, notes);

    res.status(201).json({ request, message: `GDPR ${type} request submitted. Deadline: ${request.deadlineAt}` });
  })
);

// GET /api/v1/gdpr/requests - List all GDPR requests (optionally filter by userId)
gdprRouter.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const requests = listGdprRequests(userId);
    res.json({ requests, total: requests.length });
  })
);

// GET /api/v1/gdpr/requests/:id - Get a specific GDPR request
gdprRouter.get(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    const request = getGdprRequest(req.params.id);
    if (!request) throw new AppError(404, 'GDPR request not found', 'NOT_FOUND');
    res.json({ request });
  })
);

// PATCH /api/v1/gdpr/requests/:id/status - Update request status
gdprRouter.patch(
  '/requests/:id/status',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      status: z.enum(['pending', 'processing', 'completed', 'rejected']),
      performedBy: z.string().min(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Invalid body', 'VALIDATION_ERROR', parsed.error.flatten());
    }

    const updated = updateGdprRequestStatus(req.params.id, parsed.data.status, parsed.data.performedBy);
    if (!updated) throw new AppError(404, 'GDPR request not found', 'NOT_FOUND');

    res.json({ request: updated });
  })
);

// POST /api/v1/gdpr/erasure/:userId - Right to erasure
gdprRouter.post(
  '/erasure/:userId',
  asyncHandler(async (req, res) => {
    const schema = z.object({ performedBy: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'performedBy is required', 'VALIDATION_ERROR');
    }

    const result = eraseUserData(req.params.userId, parsed.data.performedBy);
    res.json({ userId: req.params.userId, ...result, message: 'User PII erased successfully' });
  })
);

// GET /api/v1/gdpr/export/:userId - Right to data portability
gdprRouter.get(
  '/export/:userId',
  asyncHandler(async (req, res) => {
    const performedBy = typeof req.query.performedBy === 'string' ? req.query.performedBy : 'user';
    const data = exportUserData(req.params.userId, performedBy);
    res.setHeader('Content-Disposition', `attachment; filename="gdpr-export-${req.params.userId}.json"`);
    res.json(data);
  })
);

// GET /api/v1/gdpr/consent/:userId - Get user consents
gdprRouter.get(
  '/consent/:userId',
  asyncHandler(async (req, res) => {
    const consents = getUserConsents(req.params.userId);
    res.json({ userId: req.params.userId, consents });
  })
);

// POST /api/v1/gdpr/consent/:userId - Record consent grant/revoke
gdprRouter.post(
  '/consent/:userId',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      purpose: z.enum(CONSENT_PURPOSES as [ConsentPurpose, ...ConsentPurpose[]]),
      granted: z.boolean(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Invalid consent body', 'VALIDATION_ERROR', parsed.error.flatten());
    }

    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    const record = recordConsent(req.params.userId, parsed.data.purpose, parsed.data.granted, ipAddress, userAgent);
    res.status(201).json({ consent: record });
  })
);

// GET /api/v1/gdpr/processors - List third-party data processors
gdprRouter.get(
  '/processors',
  asyncHandler(async (_req, res) => {
    res.json({ processors: listThirdPartyProcessors() });
  })
);

// GET /api/v1/gdpr/retention - List data retention policies
gdprRouter.get(
  '/retention',
  asyncHandler(async (_req, res) => {
    res.json({ policies: listRetentionPolicies() });
  })
);

// GET /api/v1/gdpr/audit - GDPR audit log
gdprRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const entries = getAuditLog(userId);
    res.json({ entries, total: entries.length });
  })
);
