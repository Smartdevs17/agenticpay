/**
 * SLA Tracking Middleware
 * Instruments all requests to track response times and status codes for SLA monitoring
 */

import { Request, Response, NextFunction } from 'express';
import { slaTracker } from '../services/sla.js';

/**
 * Middleware to track SLA metrics for each request
 */
export function slaTrackingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;

  // Hook into the response finish event
  res.on('finish', () => {
    const responseTimeMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Track the request
    slaTracker.trackRequest(endpoint, responseTimeMs, statusCode, new Date());
  });

  next();
}
