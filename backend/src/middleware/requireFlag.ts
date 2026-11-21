/**
 * requireFlag.ts
 *
 * Express middleware factory that gates a route behind a feature flag.
 *
 * The caller identifier used for percentage/allowlist rollout is resolved
 * in this order:
 *   1. `X-User-Id` header (explicit user identifier)
 *   2. `Authorization` header value (token-based identity)
 *   3. `X-Api-Key` header
 *   4. `req.ip` (client IP address)
 *   5. `'anonymous'` (fallback)
 *
 * @example
 * ```ts
 * import { requireFlag } from '../middleware/requireFlag.js';
 *
 * // Block the whole router if the flag is off
 * router.use(requireFlag('bulk-verification'));
 *
 * // Or gate a single route
 * router.post('/verify/batch', requireFlag('bulk-verification'), handler);
 * ```
 */

import { Request, Response, NextFunction } from 'express';
import { featureFlags, FeatureFlagName } from '../config/featureFlags.js';
import { AppError } from './errorHandler.js';

export function requireFlag(flagName: FeatureFlagName) {
  return function featureFlagGate(req: Request, _res: Response, next: NextFunction): void {
    const identifier = resolveIdentifier(req);

    if (!featureFlags.evaluate(flagName, identifier)) {
      next(
        new AppError(
          403,
          `Feature '${flagName}' is not available`,
          'FEATURE_DISABLED',
        ),
      );
      return;
    }

    next();
  };
}

function resolveIdentifier(req: Request): string {
  const userId = req.headers['x-user-id'];
  if (typeof userId === 'string' && userId.trim()) return userId.trim();

  const auth = req.headers.authorization;
  if (auth) return auth;

  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) return apiKey.trim();

  return req.ip ?? 'anonymous';
}
