import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { getRotationService } from '../config/credential-rotation.js';
import type { CredentialKind, RotationPolicy } from '../config/credential-rotation.js';

export const credentialRotationRouter = Router();

const VALID_KINDS: CredentialKind[] = ['api_key', 'database', 'jwt_secret', 'webhook_secret', 'oauth_secret'];
const VALID_POLICIES: RotationPolicy[] = [30, 60, 90];

credentialRotationRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { kind, label, rotationPolicyDays, metadata } = req.body as {
      kind?: CredentialKind;
      label?: string;
      rotationPolicyDays?: number;
      metadata?: Record<string, unknown>;
    };

    if (!kind || !VALID_KINDS.includes(kind)) {
      throw new AppError(400, `kind must be one of: ${VALID_KINDS.join(', ')}`, 'VALIDATION_ERROR');
    }
    if (!label || typeof label !== 'string' || label.trim().length === 0) {
      throw new AppError(400, 'label is required', 'VALIDATION_ERROR');
    }
    if (rotationPolicyDays !== undefined && !VALID_POLICIES.includes(rotationPolicyDays as RotationPolicy)) {
      throw new AppError(400, `rotationPolicyDays must be one of: ${VALID_POLICIES.join(', ')}`, 'VALIDATION_ERROR');
    }

    const { credential, plaintext } = getRotationService().register({
      kind,
      label: label.trim(),
      rotationPolicyDays: rotationPolicyDays as RotationPolicy | undefined,
      metadata,
    });

    return res.status(201).json({ credential, plaintext });
  }),
);

credentialRotationRouter.post(
  '/:label/rotate',
  asyncHandler(async (req, res) => {
    const { overlapMs, performedBy } = req.body as { overlapMs?: number; performedBy?: string };
    const result = await getRotationService().rotate(req.params.label, {
      overlapMs,
      performedBy: performedBy ?? 'api',
      eventType: 'manual',
    });

    return res.json({
      previousCredentialId: result.previousCredential.id,
      newCredential: result.newCredential,
      overlapExpiresAt: result.overlapExpiresAt,
      auditId: result.auditId,
      plaintext: result.plaintext,
    });
  }),
);

credentialRotationRouter.post(
  '/:label/revoke',
  asyncHandler(async (req, res) => {
    const { reason, performedBy } = req.body as { reason?: string; performedBy?: string };

    if (!reason || typeof reason !== 'string') {
      throw new AppError(400, 'reason is required for emergency revocation', 'VALIDATION_ERROR');
    }
    if (!performedBy || typeof performedBy !== 'string') {
      throw new AppError(400, 'performedBy is required for emergency revocation', 'VALIDATION_ERROR');
    }

    const revoked = await getRotationService().emergencyRevoke(req.params.label, reason, performedBy);
    return res.json({ revoked: true, credential: revoked });
  }),
);

credentialRotationRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const creds = getRotationService().listCredentials().map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.label,
      isActive: c.isActive,
      isOverlap: c.isOverlap,
      expiresAt: c.expiresAt,
      revokedAt: c.revokedAt,
      rotationPolicyDays: c.rotationPolicyDays,
    }));
    return res.json({ credentials: creds, count: creds.length });
  }),
);

credentialRotationRouter.get(
  '/due',
  asyncHandler(async (_req, res) => {
    const due = getRotationService().getDueForRotation().map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.label,
      expiresAt: c.expiresAt,
    }));
    return res.json({ due, count: due.length });
  }),
);

credentialRotationRouter.post(
  '/scheduled',
  asyncHandler(async (_req, res) => {
    const rotated = await getRotationService().runScheduledRotation();
    return res.json({ rotated, count: rotated.length });
  }),
);

credentialRotationRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { label, limit } = req.query as { label?: string; limit?: string };
    const entries = getRotationService().getAuditLog({
      label,
      limit: limit ? Number(limit) : undefined,
    });
    return res.json({ entries, count: entries.length });
  }),
);
