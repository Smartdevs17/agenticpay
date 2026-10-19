// Token authentication middleware — Issues #512, #1014
// Verifies signed JWT access tokens (algorithm pinned, short-lived, revocable).
// Works alongside existing API-key auth; is a no-op when headers are absent.

import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { auditService } from '../services/auditService.js';
import { logger } from './logger.js';
import { getJwtService, looksLikeJwt } from '../auth/jwt.js';

function clientIp(req: Request): string | undefined {
  return (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress;
}

export async function tokenAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7).trim();

  // Legacy opaque `at_` tokens carried no verifiable claims and are no longer accepted.
  if (!looksLikeJwt(token)) {
    void auditService.logAction({
      action: 'token.auth.malformed',
      resource: 'access_token',
      ipAddress: clientIp(req),
    });
    next(new AppError(401, 'Malformed access token', 'TOKEN_MALFORMED'));
    return;
  }

  let result;
  try {
    result = await getJwtService().verifyAsync(token);
  } catch (error) {
    logger.error({ error }, 'token auth: verifier unavailable');
    next(new AppError(503, 'Token verification unavailable', 'TOKEN_VERIFIER_UNAVAILABLE'));
    return;
  }

  if (!result.ok) {
    void auditService.logAction({
      action: `token.auth.${result.reason}`,
      resource: 'access_token',
      ipAddress: clientIp(req),
    });
    const code = result.reason === 'expired' ? 'TOKEN_EXPIRED' : result.reason === 'revoked' ? 'TOKEN_REVOKED' : 'TOKEN_INVALID';
    next(new AppError(401, result.reason === 'expired' ? 'Access token has expired' : 'Invalid access token', code));
    return;
  }

  // Attach to request for downstream handlers
  req.accessToken = token;
  req.accessTokenClaims = result.claims;

  logger.debug({ ip: clientIp(req), path: req.path, sub: result.claims.sub }, 'token auth: verified bearer token');

  next();
}
