/**
 * SLA Tracking Middleware
 * Instruments all requests to track response times and status codes for SLA monitoring
 */

import { Request, Response, NextFunction } from 'express';
import { slaTracker } from '../services/sla.js';
import metrics from '../observability/datadog.js';

/**
 * Middleware to track SLA metrics for each request
 */
export function slaTrackingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const endpoint = req.route?.path || req.path;

  // Hook into the response finish event
  res.on('finish', () => {
    const responseTimeMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Track the request in SLA tracker
    slaTracker.trackRequest(`${req.method} ${req.baseUrl}${req.path}`, responseTimeMs, statusCode, new Date());

    // Emit metrics with endpoint and status code tags
    const tags = {
      endpoint,
      status_code: String(statusCode),
    };

    metrics.distribution('http.request.duration', responseTimeMs, tags);
    metrics.increment('http.requests', 1, tags);
    if (statusCode >= 400) {
      metrics.increment('http.errors', 1, tags);
    }
  });

  next();
}
