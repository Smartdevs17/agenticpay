/**
 * SLA Routes
 * API endpoints for retrieving SLA metrics, reports, and violations
 */

import { Router } from 'express';
import { slaTracker } from '../services/sla.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

export const slaRouter = Router();

/**
 * GET /api/v1/sla/metrics/:endpoint?
 * Get SLA metrics for a specific endpoint or all endpoints
 */
slaRouter.get(
  '/metrics',
  asyncHandler(async (req, res) => {
    const endpoint = req.query.endpoint as string | undefined;
    const metrics = slaTracker.getMetrics(endpoint);

    res.json({
      data: metrics,
      timestamp: new Date(),
    });
  })
);

/**
 * GET /api/v1/sla/metrics/:endpoint
 * Get SLA metrics for a specific endpoint
 */
slaRouter.get(
  '/metrics/:endpoint',
  asyncHandler(async (req, res) => {
    const endpoint = req.params.endpoint;
    const decodedEndpoint = decodeURIComponent(endpoint);
    const metrics = slaTracker.getMetrics(decodedEndpoint);

    if (!metrics || (typeof metrics !== 'string' && metrics.totalRequests === 0)) {
      throw new AppError(404, `No metrics found for endpoint: ${decodedEndpoint}`, 'NO_METRICS_FOUND');
    }

    res.json({
      data: metrics,
      timestamp: new Date(),
    });
  })
);

/**
 * GET /api/v1/sla/violations
 * Get SLA violations
 */
slaRouter.get(
  '/violations',
  asyncHandler(async (req, res) => {
    const endpoint = req.query.endpoint as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const violations = slaTracker.getViolations(endpoint, limit);

    res.json({
      data: violations,
      count: violations.length,
      timestamp: new Date(),
    });
  })
);

/**
 * GET /api/v1/sla/violations/:endpoint
 * Get SLA violations for a specific endpoint
 */
slaRouter.get(
  '/violations/:endpoint',
  asyncHandler(async (req, res) => {
    const endpoint = req.params.endpoint;
    const decodedEndpoint = decodeURIComponent(endpoint);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const violations = slaTracker.getViolations(decodedEndpoint, limit);

    res.json({
      data: violations,
      count: violations.length,
      timestamp: new Date(),
    });
  })
);

/**
 * GET /api/v1/sla/report
 * Generate comprehensive SLA report
 */
slaRouter.get(
  '/report',
  asyncHandler(async (req, res) => {
    const endpoint = req.query.endpoint as string | undefined;
    const report = slaTracker.generateReport(endpoint);

    res.json({
      report,
      timestamp: new Date(),
    });
  })
);

/**
 * GET /api/v1/sla/config
 * Get current SLA configuration
 */
slaRouter.get(
  '/config',
  asyncHandler(async (req, res) => {
    const config = slaTracker.getConfig();

    res.json({
      config,
      timestamp: new Date(),
    });
  })
);

/**
 * POST /api/v1/sla/config
 * Update SLA configuration
 */
slaRouter.post(
  '/config',
  asyncHandler(async (req, res) => {
    const { maxResponseTimeMs, maxErrorRatePercent, minUptimePercent, aggregationIntervalMs } =
      req.body;

    const update: Record<string, unknown> = {};
    if (maxResponseTimeMs !== undefined) update.maxResponseTimeMs = maxResponseTimeMs;
    if (maxErrorRatePercent !== undefined) update.maxErrorRatePercent = maxErrorRatePercent;
    if (minUptimePercent !== undefined) update.minUptimePercent = minUptimePercent;
    if (aggregationIntervalMs !== undefined) update.aggregationIntervalMs = aggregationIntervalMs;

    if (Object.keys(update).length === 0) {
      throw new AppError(400, 'At least one configuration parameter must be provided', 'INVALID_REQUEST');
    }

    slaTracker.updateConfig(update as Parameters<typeof slaTracker.updateConfig>[0]);

    res.json({
      config: slaTracker.getConfig(),
      message: 'SLA configuration updated',
      timestamp: new Date(),
    });
  })
);

/**
 * DELETE /api/v1/sla/metrics/:endpoint?
 * Clear metrics for a specific endpoint or all endpoints
 */
slaRouter.delete(
  '/metrics',
  asyncHandler(async (req, res) => {
    const endpoint = req.query.endpoint as string | undefined;
    const decodedEndpoint = endpoint ? decodeURIComponent(endpoint) : undefined;

    slaTracker.reset(decodedEndpoint);

    res.json({
      message: decodedEndpoint ? `Metrics cleared for ${decodedEndpoint}` : 'All metrics cleared',
      timestamp: new Date(),
    });
  })
);
