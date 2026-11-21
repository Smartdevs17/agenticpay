// dispute-resolution.ts — Issue #641
// Mounted at /api/v1/dispute-resolution
//
// POST   /disputes                 — open a structured payment dispute
// GET    /disputes                 — list disputes (tenant/status/party filters)
// GET    /disputes/:id             — dispute detail (evidence, timeline, notifications)
// POST   /disputes/:id/respond     — party response → under_review
// POST   /disputes/:id/evidence    — upload/register evidence (SHA-256 hash)
// GET    /disputes/:id/evidence    — list evidence for a dispute
// DELETE /disputes/:id/evidence/:evidenceId — remove evidence (open disputes only)
// POST   /disputes/:id/assign      — assign arbitrator
// POST   /disputes/:id/escalate    — escalate to arbitration
// POST   /disputes/:id/resolve     — resolve / dismiss with outcome tracking
// GET    /disputes/:id/timeline    — audit / resolution timeline
// GET    /disputes/:id/resolutions — resolution records
// GET    /disputes/:id/notifications — dispute notification log
// GET    /analytics                — dispute analytics
// POST   /escalations/process      — run SLA auto-escalation pass

import { Router, Request } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import type { Result } from '../lib/result.js';
import {
  disputeResolutionService,
  ALL_STATUSES,
  VALID_OUTCOMES,
  VALID_REASONS,
  type DisputeReason,
  type DisputeStatus,
  type ResolutionOutcome,
} from '../services/dispute-resolution/index.js';

export const disputeResolutionRouter = Router();

function paramId(req: Request, name = 'id'): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new AppError(result.error.statusCode, result.error.message, result.error.code);
  }
  return result.value;
}

function parseStatus(value: unknown): DisputeStatus | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !ALL_STATUSES.includes(value as DisputeStatus)) {
    throw new AppError(400, `status must be one of ${ALL_STATUSES.join(', ')}`, 'VALIDATION_ERROR');
  }
  return value as DisputeStatus;
}

disputeResolutionRouter.post(
  '/disputes',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const reason = body.reason;
    if (typeof reason !== 'string' || !VALID_REASONS.includes(reason as DisputeReason)) {
      throw new AppError(400, `reason must be one of ${VALID_REASONS.join(', ')}`, 'VALIDATION_ERROR');
    }
    const detail = unwrap(
      await disputeResolutionService.createDispute({
        tenantId: String(body.tenantId ?? ''),
        paymentId: String(body.paymentId ?? ''),
        filedBy: String(body.filedBy ?? ''),
        respondentId: String(body.respondentId ?? ''),
        reason: reason as DisputeReason,
        amount: Number(body.amount),
        currency: String(body.currency ?? ''),
        description: String(body.description ?? ''),
        projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
        invoiceId: typeof body.invoiceId === 'string' ? body.invoiceId : undefined,
      }),
    );
    res.status(201).json(detail);
  }),
);

disputeResolutionRouter.get(
  '/disputes',
  asyncHandler(async (req, res) => {
    const disputes = unwrap(
      disputeResolutionService.listDisputes({
        tenantId: typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined,
        status: parseStatus(req.query.status),
        filedBy: typeof req.query.filedBy === 'string' ? req.query.filedBy : undefined,
        respondentId: typeof req.query.respondentId === 'string' ? req.query.respondentId : undefined,
        arbitratorId: typeof req.query.arbitratorId === 'string' ? req.query.arbitratorId : undefined,
        paymentId: typeof req.query.paymentId === 'string' ? req.query.paymentId : undefined,
      }),
    );
    res.json({ disputes, total: disputes.length });
  }),
);

disputeResolutionRouter.get(
  '/disputes/:id',
  asyncHandler(async (req, res) => {
    res.json(unwrap(disputeResolutionService.getDispute(paramId(req))));
  }),
);

disputeResolutionRouter.post(
  '/disputes/:id/respond',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const senderRole = body.senderRole;
    if (senderRole !== 'payer' && senderRole !== 'payee' && senderRole !== 'arbitrator') {
      throw new AppError(400, 'senderRole must be payer | payee | arbitrator', 'VALIDATION_ERROR');
    }
    const detail = unwrap(
      await disputeResolutionService.respond(paramId(req), {
        senderId: String(body.senderId ?? ''),
        senderRole,
        content: String(body.content ?? ''),
      }),
    );
    res.json(detail);
  }),
);

disputeResolutionRouter.post(
  '/disputes/:id/evidence',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const evidence = unwrap(
      await disputeResolutionService.addEvidence(paramId(req), {
        submittedBy: String(body.submittedBy ?? ''),
        fileUrl: String(body.fileUrl ?? ''),
        fileName: String(body.fileName ?? ''),
        fileType: String(body.fileType ?? ''),
        fileSize: Number(body.fileSize),
        description: String(body.description ?? ''),
        contentBytes: typeof body.contentBytes === 'string' ? body.contentBytes : undefined,
      }),
    );
    res.status(201).json(evidence);
  }),
);

disputeResolutionRouter.get(
  '/disputes/:id/evidence',
  asyncHandler(async (req, res) => {
    const evidence = unwrap(disputeResolutionService.listEvidence(paramId(req)));
    res.json({ evidence, total: evidence.length });
  }),
);

disputeResolutionRouter.delete(
  '/disputes/:id/evidence/:evidenceId',
  asyncHandler(async (req, res) => {
    const actorId = typeof req.body?.actorId === 'string' ? req.body.actorId : 'system';
    const detail = unwrap(
      await disputeResolutionService.removeEvidence(paramId(req), paramId(req, 'evidenceId'), actorId),
    );
    res.json(detail);
  }),
);

disputeResolutionRouter.post(
  '/disputes/:id/assign',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const detail = unwrap(
      await disputeResolutionService.assignArbitrator(
        paramId(req),
        String(body.arbitratorId ?? ''),
        String(body.actorId ?? 'system'),
      ),
    );
    res.json(detail);
  }),
);

disputeResolutionRouter.post(
  '/disputes/:id/escalate',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const detail = unwrap(
      await disputeResolutionService.escalate(
        paramId(req),
        String(body.actorId ?? 'system'),
        typeof body.note === 'string' ? body.note : 'Manual escalation',
      ),
    );
    res.json(detail);
  }),
);

disputeResolutionRouter.post(
  '/disputes/:id/resolve',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const outcome = body.outcome;
    if (typeof outcome !== 'string' || !VALID_OUTCOMES.includes(outcome as ResolutionOutcome)) {
      throw new AppError(400, `outcome must be one of ${VALID_OUTCOMES.join(', ')}`, 'VALIDATION_ERROR');
    }
    const detail = unwrap(
      await disputeResolutionService.resolve(paramId(req), {
        outcome: outcome as ResolutionOutcome,
        resolutionNote: String(body.resolutionNote ?? ''),
        resolvedBy: String(body.resolvedBy ?? ''),
        resolvedByRole:
          body.resolvedByRole === 'system' || body.resolvedByRole === 'admin'
            ? body.resolvedByRole
            : 'arbitrator',
        refundAmount: typeof body.refundAmount === 'number' ? body.refundAmount : undefined,
      }),
    );
    res.json(detail);
  }),
);

disputeResolutionRouter.get(
  '/disputes/:id/timeline',
  asyncHandler(async (req, res) => {
    const timeline = unwrap(disputeResolutionService.getTimeline(paramId(req)));
    res.json({ timeline, total: timeline.length });
  }),
);

disputeResolutionRouter.get(
  '/disputes/:id/resolutions',
  asyncHandler(async (req, res) => {
    const resolutions = unwrap(disputeResolutionService.getResolutions(paramId(req)));
    res.json({ resolutions, total: resolutions.length });
  }),
);

disputeResolutionRouter.get(
  '/disputes/:id/notifications',
  asyncHandler(async (req, res) => {
    const notifications = unwrap(disputeResolutionService.listNotifications(paramId(req)));
    res.json({ notifications, total: notifications.length });
  }),
);

disputeResolutionRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
    res.json(unwrap(disputeResolutionService.getAnalytics(tenantId)));
  }),
);

disputeResolutionRouter.post(
  '/escalations/process',
  asyncHandler(async (_req, res) => {
    res.json(unwrap(await disputeResolutionService.processEscalations()));
  }),
);
