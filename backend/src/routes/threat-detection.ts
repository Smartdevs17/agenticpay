import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';
import {
  recordBehaviorEvent,
  getBaseline,
  getAllThreats,
  getThreatById,
  getThreatsByUser,
  getOpenThreats,
  updateThreatStatus,
  unlockAccount,
  isAccountLocked,
  getThreatStats,
  refreshThreatIntel,
  getThreatIntelStatus,
} from '../services/threat-detection.js';
import type { ThreatStatus } from '../types/threat-detection.js';

export const threatDetectionRouter = Router();

threatDetectionRouter.post(
  '/events',
  asyncHandler(async (req, res) => {
    const { userId, action, ipAddress, userAgent, endpoint, method, statusCode, durationMs, metadata } =
      req.body as {
        userId?: string;
        action?: string;
        ipAddress?: string;
        userAgent?: string;
        endpoint?: string;
        method?: string;
        statusCode?: number;
        durationMs?: number;
        metadata?: Record<string, unknown>;
      };

    if (!userId || !action || !ipAddress || !endpoint || !method) {
      throw new AppError(400, 'userId, action, ipAddress, endpoint and method are required', 'VALIDATION_ERROR');
    }

    const score = recordBehaviorEvent({
      userId,
      action,
      ipAddress,
      userAgent: userAgent ?? 'unknown',
      endpoint,
      method,
      statusCode: statusCode ?? 200,
      durationMs: durationMs ?? 0,
      timestamp: new Date().toISOString(),
      metadata,
    });

    res.json(score);
  })
);

threatDetectionRouter.get(
  '/stats',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (_req, res) => {
    res.json(getThreatStats());
  })
);

threatDetectionRouter.get(
  '/threats',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const threats = req.query.open === 'true' ? getOpenThreats() : getAllThreats();
    res.json({ threats, count: threats.length });
  })
);

threatDetectionRouter.get(
  '/threats/:id',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const threat = getThreatById(req.params.id);
    if (!threat) throw new AppError(404, 'Threat not found', 'NOT_FOUND');
    res.json(threat);
  })
);

threatDetectionRouter.patch(
  '/threats/:id/status',
  asyncHandler(async (req, res) => {
    const { status, resolution } = req.body as { status?: ThreatStatus; resolution?: string };
    if (!status) throw new AppError(400, 'status is required', 'VALIDATION_ERROR');

    const updated = updateThreatStatus(req.params.id, status, resolution);
    if (!updated) throw new AppError(404, 'Threat not found', 'NOT_FOUND');
    res.json(updated);
  })
);

threatDetectionRouter.get(
  '/users/:userId/threats',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const threats = getThreatsByUser(req.params.userId);
    res.json({ userId: req.params.userId, threats, count: threats.length });
  })
);

threatDetectionRouter.get(
  '/users/:userId/baseline',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const baseline = getBaseline(req.params.userId);
    if (!baseline) throw new AppError(404, 'No baseline found for user', 'NOT_FOUND');
    res.json(baseline);
  })
);

threatDetectionRouter.get(
  '/users/:userId/locked',
  asyncHandler(async (req, res) => {
    res.json({ userId: req.params.userId, locked: isAccountLocked(req.params.userId) });
  })
);

threatDetectionRouter.post(
  '/users/:userId/unlock',
  asyncHandler(async (req, res) => {
    const unlocked = unlockAccount(req.params.userId);
    res.json({ userId: req.params.userId, unlocked });
  })
);

threatDetectionRouter.get(
  '/intel/status',
  cacheControl({ maxAge: CacheTTL.LONG }),
  asyncHandler(async (_req, res) => {
    res.json(getThreatIntelStatus());
  })
);

threatDetectionRouter.post(
  '/intel/refresh',
  asyncHandler(async (req, res) => {
    const { maliciousIps } = req.body as { maliciousIps?: string[] };
    if (!Array.isArray(maliciousIps)) {
      throw new AppError(400, 'maliciousIps array is required', 'VALIDATION_ERROR');
    }
    refreshThreatIntel(maliciousIps);
    res.json({ message: 'Threat intel refreshed', ...getThreatIntelStatus() });
  })
);
