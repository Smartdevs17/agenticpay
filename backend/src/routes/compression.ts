/**
 * Issue #821 — Request/Response Compression
 * Admin routes: compression metrics, per-endpoint config, health check.
 */

import { Router, Request, Response } from 'express';
import {
  getCompressionMetrics,
  configureEndpoint,
  resetCompressionMetrics,
  type CompressionConfig,
} from '../middleware/compression.js';

export const compressionRouter = Router();

compressionRouter.get('/metrics', (_req: Request, res: Response) => {
  const m = getCompressionMetrics();
  res.json({
    data: {
      ...m,
      compressionRatioPercent: `${m.compressionRatio.toFixed(2)}%`,
    },
  });
});

compressionRouter.post('/metrics/reset', (_req: Request, res: Response) => {
  resetCompressionMetrics();
  res.json({ message: 'Compression metrics reset.' });
});

compressionRouter.post('/configure', (req: Request, res: Response) => {
  const { endpoint, ...config } = req.body as { endpoint: string } & Partial<CompressionConfig>;
  if (!endpoint || typeof endpoint !== 'string') {
    res.status(400).json({ error: 'endpoint is required.' });
    return;
  }
  if (config.level !== undefined && (config.level < 1 || config.level > 9)) {
    res.status(400).json({ error: 'level must be 1-9.' });
    return;
  }
  if (config.brotliQuality !== undefined && (config.brotliQuality < 0 || config.brotliQuality > 11)) {
    res.status(400).json({ error: 'brotliQuality must be 0-11.' });
    return;
  }
  configureEndpoint(endpoint, config);
  res.json({ message: `Compression configured for '${endpoint}'.`, data: { endpoint, ...config } });
});

compressionRouter.get('/health', (_req: Request, res: Response) => {
  const m = getCompressionMetrics();
  res.json({
    status: 'active',
    supportedEncodings: ['br', 'gzip', 'deflate'],
    totalRequestsTracked: m.totalRequests,
    activeEndpointOverrides: m.activeEndpoints.length,
  });
});
