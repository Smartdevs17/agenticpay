/**
 * Issue #822 — API Versioning with Deprecation Headers
 * Admin routes for version registry management.
 *
 * Routes (all under /api/v1/api-versions):
 *   GET  /           — list all registered API versions
 *   POST /           — register a new version
 *   GET  /:version   — get a single version's details
 *   POST /:version/deprecate — mark a version deprecated with sunset date
 */

import { Router, Request, Response } from 'express';
import {
  listVersions,
  getVersion,
  registerVersion,
  deprecateVersion,
  type ApiVersion,
} from '../middleware/versioning.js';

export const apiVersionsRouter = Router();

apiVersionsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ data: listVersions(), total: listVersions().length });
});

apiVersionsRouter.get('/:version', (req: Request, res: Response) => {
  const info = getVersion(req.params.version);
  if (!info) {
    res.status(404).json({ error: `Version '${req.params.version}' not found.` });
    return;
  }
  res.json({ data: info });
});

apiVersionsRouter.post('/', (req: Request, res: Response) => {
  const { version, description, changelogUrl, alternativeVersion } = req.body as Partial<ApiVersion>;
  if (!version || !/^v\d+/.test(version)) {
    res.status(400).json({ error: 'version is required and must match /^v\\d+/' });
    return;
  }
  registerVersion({ version, description, changelogUrl, alternativeVersion });
  res.status(201).json({ message: `Version '${version}' registered.`, data: getVersion(version) });
});

apiVersionsRouter.post('/:version/deprecate', (req: Request, res: Response) => {
  const { sunsetDate, alternativeVersion } = req.body as { sunsetDate?: string; alternativeVersion?: string };
  if (!sunsetDate || isNaN(Date.parse(sunsetDate))) {
    res.status(400).json({ error: 'sunsetDate is required and must be a valid ISO-8601 datetime.' });
    return;
  }
  try {
    deprecateVersion(req.params.version, new Date(sunsetDate), alternativeVersion);
    res.json({ message: `Version '${req.params.version}' marked deprecated.`, data: getVersion(req.params.version) });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});
