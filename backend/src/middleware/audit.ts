import type { Request, Response, NextFunction } from 'express';
import { auditService } from '../services/auditService.js';

export interface AuditMiddlewareOptions {
  excludePaths?: string[];
  actionMapper?: (req: Request) => string;
  resourceMapper?: (req: Request) => string;
}

/**
 * Derive a stable resource name from a request path, skipping the API version
 * segment so `/api/v1/payments` becomes `payments` rather than `v1`.
 */
export function deriveAuditResource(req: Request): string {
  const segments = req.baseUrl ? req.baseUrl.split('/') : req.path.split('/');
  const filtered = segments.filter(Boolean);
  if (filtered.length === 0) return 'root';

  const versionIndex = filtered.findIndex((segment) => /^v\d+$/.test(segment));
  const resourceIndex = versionIndex >= 0 ? versionIndex + 1 : 1;
  return filtered[resourceIndex] ?? filtered[filtered.length - 1] ?? 'root';
}

/**
 * Express middleware that records user and system operations to the tamper-evident audit log.
 */
export function auditMiddleware(options: AuditMiddlewareOptions = {}) {
  const excludePaths = options.excludePaths || ['/health', '/metrics', '/api-docs'];

  return (req: Request, res: Response, next: NextFunction): void => {
    // Check if the path should be excluded from audit logging
    const isExcluded = excludePaths.some((p) => req.path.startsWith(p));
    if (isExcluded) {
      next();
      return;
    }

    const startTime = Date.now();

    // Hook into response finish event to write the audit entry
    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      
      // Determine the user identifier from authorization context
      const userId =
        (req as any).user?.id ||
        req.headers['x-user-id'] ||
        req.headers['x-api-key'] ||
        'anonymous';

      // Map action and resource
      const action = options.actionMapper
        ? options.actionMapper(req)
        : `${req.method} ${req.path}`;
      
      const resource = options.resourceMapper ? options.resourceMapper(req) : deriveAuditResource(req);

      // Capture request body (sanitization happens inside auditService.logAction)
      const requestBody = req.body;

      void auditService.logAction({
        userId: String(userId),
        action,
        resource,
        resourceId: req.params?.id || (req.body?.id ? String(req.body.id) : undefined),
        details: {
          durationMs,
          query: req.query,
          headers: {
            host: req.headers.host,
            accept: req.headers.accept,
          },
        },
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
        request: {
          method: req.method,
          path: req.path,
          body: requestBody,
        },
        response: {
          status: res.statusCode,
        },
      }).catch((err) => {
        console.error('[audit] Failed to write audit entry', err);
      });
    });

    next();
  };
}
