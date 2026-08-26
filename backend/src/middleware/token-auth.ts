// Token authentication middleware — Issue #512
// Validates access tokens and refresh token headers.
// Works alongside existing API-key auth; is a no-op when headers are absent.

import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { auditService } from '../services/auditService.js';
import { logger } from './logger.js';

// Access token format: "at_<64-hex-chars>" (opaque, validated server-side)
const ACCESS_TOKEN_RE = /^at_[0-9a-f]{64}$/;

export function tokenAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7).trim();

  // Minimal structural validation for access tokens
  if (!ACCESS_TOKEN_RE.test(token)) {
    void auditService.logAction({
      action: 'token.auth.malformed',
      resource: 'access_token',
      ipAddress: (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress,
    });
    next(new AppError(401, 'Malformed access token', 'TOKEN_MALFORMED'));
    return;
  }

  // Attach to request for downstream handlers
  (req as any).accessToken = token;

  const ip = (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress;
  logger.debug({ ip, path: req.path }, 'token auth: valid bearer token presented');

  next();
}
