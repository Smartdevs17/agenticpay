import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';
import {
  appendEvent,
  loadEvents,
  loadSnapshot,
  getAllEvents,
  getEventsByType,
  getAllStreams,
  getEventStats,
} from '../events/event-store.js';
import {
  getAllPayments,
  getAllProjects,
  getAllVerifications,
  getPaymentReadModel,
  getProjectReadModel,
  getVerificationReadModel,
} from '../events/projections.js';
import { publish } from '../events/event-bus.js';
import type { DomainEventType } from '../events/event-types.js';

export const eventsRouter = Router();

eventsRouter.post(
  '/append',
  asyncHandler(async (req, res) => {
    const { aggregateType, aggregateId, type, payload, metadata, expectedVersion } = req.body as {
      aggregateType?: string;
      aggregateId?: string;
      type?: string;
      payload?: unknown;
      metadata?: Record<string, string>;
      expectedVersion?: number;
    };

    if (!aggregateType || !aggregateId || !type) {
      throw new AppError(400, 'aggregateType, aggregateId and type are required', 'VALIDATION_ERROR');
    }

    try {
      const stored = appendEvent(
        aggregateType,
        aggregateId,
        type as DomainEventType,
        payload ?? {},
        metadata ?? {},
        { expectedVersion }
      );
      await publish(stored);
      res.status(201).json(stored);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Append failed';
      throw new AppError(409, msg, 'CONCURRENCY_CONFLICT');
    }
  })
);

eventsRouter.get(
  '/streams',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (_req, res) => {
    res.json(getAllStreams());
  })
);

eventsRouter.get(
  '/streams/:aggregateType/:aggregateId',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const { aggregateType, aggregateId } = req.params;
    const fromVersion = parseInt(req.query.fromVersion as string) || 0;
    const events = loadEvents(aggregateType, aggregateId, fromVersion);
    res.json({ aggregateType, aggregateId, events, count: events.length });
  })
);

eventsRouter.get(
  '/streams/:aggregateType/:aggregateId/snapshot',
  asyncHandler(async (req, res) => {
    const { aggregateType, aggregateId } = req.params;
    const { asOf } = req.query as { asOf?: string };

    if (!asOf) {
      throw new AppError(400, 'asOf query parameter is required (ISO 8601)', 'VALIDATION_ERROR');
    }

    const events = loadSnapshot({ aggregateType, aggregateId, asOf });
    res.json({ aggregateType, aggregateId, asOf, events, count: events.length });
  })
);

eventsRouter.get(
  '/global',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const fromSequence = parseInt(req.query.fromSequence as string) || 0;
    const events = getAllEvents(fromSequence);
    res.json({ events, count: events.length });
  })
);

eventsRouter.get(
  '/by-type/:type',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const events = getEventsByType(req.params.type as DomainEventType);
    res.json({ type: req.params.type, events, count: events.length });
  })
);

eventsRouter.get(
  '/stats',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (_req, res) => {
    res.json(getEventStats());
  })
);

// CQRS read model endpoints
eventsRouter.get(
  '/projections/payments',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (_req, res) => {
    res.json(getAllPayments());
  })
);

eventsRouter.get(
  '/projections/payments/:paymentId',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const model = getPaymentReadModel(req.params.paymentId);
    if (!model) throw new AppError(404, 'Payment projection not found', 'NOT_FOUND');
    res.json(model);
  })
);

eventsRouter.get(
  '/projections/projects',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (_req, res) => {
    res.json(getAllProjects());
  })
);

eventsRouter.get(
  '/projections/projects/:projectId',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const model = getProjectReadModel(req.params.projectId);
    if (!model) throw new AppError(404, 'Project projection not found', 'NOT_FOUND');
    res.json(model);
  })
);

eventsRouter.get(
  '/projections/verifications',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (_req, res) => {
    res.json(getAllVerifications());
  })
);

eventsRouter.get(
  '/projections/verifications/:verificationId',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const model = getVerificationReadModel(req.params.verificationId);
    if (!model) throw new AppError(404, 'Verification projection not found', 'NOT_FOUND');
    res.json(model);
  })
);
