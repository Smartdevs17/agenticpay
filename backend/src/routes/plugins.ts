import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { pluginRegistry } from '../plugins/index.js';

export const pluginsRouter = Router();

pluginsRouter.get(
  '/marketplace',
  asyncHandler(async (_req, res) => {
    res.json({ data: pluginRegistry.marketplace() });
  })
);

pluginsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: await pluginRegistry.list() });
  })
);

pluginsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, version, source, compatibility, config } = req.body as {
      name?: string;
      version?: string;
      source?: string;
      compatibility?: { agenticPay?: string; node?: string };
      config?: Record<string, unknown>;
    };
    if (!name || !version || !source) {
      throw new AppError(400, 'name, version, and source are required', 'VALIDATION_ERROR');
    }
    const plugin = await pluginRegistry.install({
      name,
      version,
      source,
      compatibility,
      config,
      actorId: req.headers['x-user-id'] as string | undefined,
    });
    res.status(201).json({ data: plugin });
  })
);

pluginsRouter.post(
  '/:pluginId/enable',
  asyncHandler(async (req, res) => {
    res.json({ data: await pluginRegistry.enable(req.params.pluginId, req.headers['x-user-id'] as string | undefined) });
  })
);

pluginsRouter.post(
  '/:pluginId/disable',
  asyncHandler(async (req, res) => {
    const { reason } = req.body as { reason?: string };
    res.json({ data: await pluginRegistry.disable(req.params.pluginId, req.headers['x-user-id'] as string | undefined, reason) });
  })
);

pluginsRouter.put(
  '/:pluginId',
  asyncHandler(async (req, res) => {
    const { version, source } = req.body as { version?: string; source?: string };
    if (!version && !source) {
      throw new AppError(400, 'version or source is required', 'VALIDATION_ERROR');
    }
    res.json({
      data: await pluginRegistry.update(req.params.pluginId, {
        version,
        source,
        actorId: req.headers['x-user-id'] as string | undefined,
      }),
    });
  })
);

pluginsRouter.put(
  '/:pluginId/config',
  asyncHandler(async (req, res) => {
    await pluginRegistry.updateConfig(req.params.pluginId, req.body as Record<string, unknown>, req.headers['x-user-id'] as string | undefined);
    res.status(204).send();
  })
);

pluginsRouter.delete(
  '/:pluginId',
  asyncHandler(async (req, res) => {
    res.json({ data: await pluginRegistry.remove(req.params.pluginId, req.headers['x-user-id'] as string | undefined) });
  })
);

pluginsRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    res.json({ data: await pluginRegistry.auditLog(req.query.pluginId as string | undefined) });
  })
);
