/**
 * provider-credentials.ts (routes) — Issue #1010
 *
 * Admin surface for the encrypted-at-rest provider credential vault:
 * - GET    /provider-credentials                        → list metadata (no secrets)
 * - PUT    /provider-credentials/:provider/:name        → store / replace a secret
 * - GET    /provider-credentials/:provider/:name        → metadata for one credential
 * - POST   /provider-credentials/:provider/:name/reveal → decrypt a secret (audited)
 * - DELETE /provider-credentials/:provider/:name        → remove a secret
 * - POST   /provider-credentials/rotate-key             → re-encrypt under the current master key
 */

import { Router, type Request } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { providerCredentialVault as vault } from '../services/provider-credentials.js';

export const providerCredentialsRouter = Router();

/** Best-effort actor identity for the audit trail; never used for authorisation here. */
function actorId(req: Request): string {
  const fromUser = req.user?.id;
  if (typeof fromUser === 'string' && fromUser.length > 0) return fromUser;
  const header = req.headers['x-actor-id'];
  return typeof header === 'string' && header.length > 0 ? header : 'unknown';
}

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

providerCredentialsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const provider = typeof req.query.provider === 'string' ? req.query.provider : undefined;
    const credentials = vault.list(provider ? { provider } : {});
    res.json({ data: credentials, count: credentials.length });
  }),
);

providerCredentialsRouter.post(
  '/rotate-key',
  asyncHandler(async (req, res) => {
    const result = vault.rotateMasterKey(actorId(req));
    if (result.failed.length > 0 && result.rotated === 0) {
      throw new AppError(500, 'Credential re-encryption failed', 'PROVIDER_CREDENTIAL_ROTATION_FAILED', result);
    }
    res.json({ data: result });
  }),
);

providerCredentialsRouter.put(
  '/:provider/:name',
  asyncHandler(async (req, res) => {
    const { value, ttlMs } = (req.body ?? {}) as { value?: unknown; ttlMs?: unknown };
    if (typeof value !== 'string' || value.length === 0) {
      throw new AppError(400, 'value is required', 'VALIDATION_ERROR');
    }
    if (ttlMs !== undefined && (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0)) {
      throw new AppError(400, 'ttlMs must be a positive number', 'VALIDATION_ERROR');
    }

    try {
      const credential = vault.put({
        provider: param(req.params.provider),
        name: param(req.params.name),
        value,
        ...(ttlMs !== undefined ? { ttlMs: ttlMs as number } : {}),
        actorId: actorId(req),
      });
      res.status(201).json({ data: credential });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'PROVIDER_CREDENTIAL_ERROR';
      throw new AppError(400, 'Invalid provider credential', code);
    }
  }),
);

providerCredentialsRouter.get(
  '/:provider/:name',
  asyncHandler(async (req, res) => {
    const credential = vault.get({
      provider: param(req.params.provider),
      name: param(req.params.name),
    });
    if (!credential) throw new AppError(404, 'Provider credential not found', 'NOT_FOUND');
    res.json({ data: credential });
  }),
);

providerCredentialsRouter.post(
  '/:provider/:name/reveal',
  asyncHandler(async (req, res) => {
    const value = vault.reveal({
      provider: param(req.params.provider),
      name: param(req.params.name),
      actorId: actorId(req),
    });
    if (value === undefined) throw new AppError(404, 'Provider credential not found', 'NOT_FOUND');
    res.json({ data: { value } });
  }),
);

providerCredentialsRouter.delete(
  '/:provider/:name',
  asyncHandler(async (req, res) => {
    const removed = vault.delete({
      provider: param(req.params.provider),
      name: param(req.params.name),
      actorId: actorId(req),
    });
    if (!removed) throw new AppError(404, 'Provider credential not found', 'NOT_FOUND');
    res.status(204).send();
  }),
);
