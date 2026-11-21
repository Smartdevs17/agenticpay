/**
 * routes/cors.ts — Runtime CORS policy management.
 *
 * Admin surface for the dynamic origin allowlist. Changes apply to the very
 * next request through the shared `CORSOriginPolicy` — no redeploy needed.
 *
 * Security note: this router mutates cross-origin policy for the whole API.
 * Mount it behind an auth/ACL middleware in production (the IP-allowlist and
 * CORS routers share this convention in this codebase).
 */

import express from 'express';
import { z } from 'zod';
import {
  getCorsPolicy,
  CorsPolicyError,
  getCorsMetrics,
} from '../services/cors.js';

const router = express.Router();

const allowedOriginsSchema = z
  .array(z.string(), { errorMap: () => ({ message: 'expected an array of origin strings' }) })
  .max(500);

const upsertSchema = z.object({
  origin: z.string({ errorMap: () => ({ message: 'origin must be a string' }) }).trim().min(1),
});

const configSchema = z.object({
  allowedOrigins: allowedOriginsSchema,
  allowCredentials: z.boolean().optional(),
});

function policyError(res: express.Response, err: unknown): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_FAILED', message: err.issues[0]?.message ?? 'Invalid input', status: 400 },
    });
    return;
  }
  if (err instanceof CorsPolicyError) {
    res.status(400).json({
      error: { code: err.code, message: err.message, status: 400 },
    });
    return;
  }
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Failed to update CORS policy', status: 500 },
  });
}

router.get(
  '/config',
  (_req, res) => {
    const policy = getCorsPolicy();
    res.json({
      allowCredentials: policy.credentials,
      wildcard: policy.wildcard,
      origins: policy.list(),
      version: policy.version,
      metrics: getCorsMetrics(),
    });
  }
);

router.put(
  '/config',
  (req, res) => {
    try {
      const body = configSchema.parse(req.body);
      const policy = getCorsPolicy();
      policy.set(body.allowedOrigins);
      if (body.allowCredentials !== undefined) {
        policy.setCredentials(body.allowCredentials);
      }
      res.json({
        message: 'CORS policy updated',
        origins: policy.list(),
        wildcard: policy.wildcard,
        version: policy.version,
        allowCredentials: policy.credentials,
      });
    } catch (err) {
      policyError(res, err);
    }
  }
);

router.get(
  '/origins',
  (_req, res) => {
    res.json({ origins: getCorsPolicy().list() });
  }
);

router.post(
  '/origins',
  (req, res) => {
    try {
      const { origin } = upsertSchema.parse(req.body);
      const size = getCorsPolicy().add(origin);
      res.status(201).json({ message: 'Origin added', origin, size });
    } catch (err) {
      policyError(res, err);
    }
  }
);

router.delete(
  '/origins',
  (req, res) => {
    const parsed = z.string().trim().min(1).safeParse(req.query.origin);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_FAILED', message: 'origin query param is required', status: 400 },
      });
      return;
    }
    const removed = getCorsPolicy().remove(parsed.data);
    res.json({ message: removed ? 'Origin removed' : 'Origin not found', origin: parsed.data, removed });
  }
);

router.post(
  '/refresh',
  (req, res) => {
    getCorsPolicy()
      .refresh()
      .then((origins) => {
        res.json({ message: 'CORS policy refreshed', origins });
      })
      .catch((err) => {
        policyError(res, err);
      });
  }
);

export const corsRouter = router;