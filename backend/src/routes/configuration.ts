import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { configurationService } from '../services/config/index.js';

export const configurationRouter = Router();

function actorFromRequest(req: any): string | undefined {
  return req.user?.id ?? req.headers['x-actor-id']?.toString();
}

configurationRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    await configurationService.init();
    res.json({ data: configurationService.list() });
  })
);

configurationRouter.get(
  '/schema',
  asyncHandler(async (_req, res) => {
    res.json({ data: configurationService.schema() });
  })
);

configurationRouter.get(
  '/export',
  asyncHandler(async (_req, res) => {
    await configurationService.init();
    res.json({ values: configurationService.export() });
  })
);

configurationRouter.post(
  '/import',
  asyncHandler(async (req, res) => {
    await configurationService.init();
    const updated = await configurationService.import(
      req.body.values ?? {},
      actorFromRequest(req),
      req.body.reason,
      req.requestId
    );
    res.json({ updated });
  })
);

configurationRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const rows = await configurationService.audit(limit);
    res.json({
      data: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  })
);

configurationRouter.get(
  '/:key',
  asyncHandler(async (req, res) => {
    await configurationService.init();
    res.json(configurationService.get(req.params.key as any));
  })
);

configurationRouter.put(
  '/:key',
  asyncHandler(async (req, res) => {
    await configurationService.init();
    const updated = await configurationService.update({
      key: req.params.key,
      value: req.body.value,
      actor: actorFromRequest(req),
      reason: req.body.reason,
      requestId: req.requestId,
      expectedVersion: req.body.expectedVersion,
    });
    res.json(updated);
  })
);

configurationRouter.put(
  '/:key/runtime',
  asyncHandler(async (req, res) => {
    await configurationService.init();
    const updated = await configurationService.setRuntimeOverride(req.params.key, req.body.value);
    res.json(updated);
  })
);
