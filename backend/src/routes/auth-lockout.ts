// Auth Lockout routes — Issue #805
// GET    /auth/lockout/status/:identifier   — check lockout status
// POST   /auth/lockout/attempt              — record a login attempt
// POST   /auth/lockout/unlock/:accountId    — unlock an account
// GET    /auth/lockout/attempts             — list recent login attempts
// DELETE /auth/lockout/clear/:identifier    — clear lockout for identifier

import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { lockoutManager } from '../services/auth/lockout-manager.js';

export const authLockoutRouter = Router();

// GET /auth/lockout/status/:identifier
authLockoutRouter.get(
  '/status/:identifier',
  asyncHandler(async (req, res) => {
    const { identifier } = req.params;
    if (!identifier || typeof identifier !== 'string') {
      throw new AppError(400, 'identifier is required', 'MISSING_IDENTIFIER');
    }

    // identifier can be "accountId:ipAddress" or just an accountId with a dummy IP
    const parts = identifier.split(':');
    const accountId = parts[0];
    const ipAddress = parts.length >= 2 ? parts.slice(1).join(':') : '0.0.0.0';

    const status = lockoutManager.getStatus(accountId, ipAddress);
    res.json({ identifier, status });
  }),
);

// POST /auth/lockout/attempt
authLockoutRouter.post(
  '/attempt',
  asyncHandler(async (req, res) => {
    const { accountId, ipAddress, success, reason, userAgent } = req.body as {
      accountId?: string;
      ipAddress?: string;
      success?: boolean;
      reason?: string;
      userAgent?: string;
    };

    if (!accountId || typeof accountId !== 'string') {
      throw new AppError(400, 'accountId is required', 'MISSING_ACCOUNT_ID');
    }
    if (!ipAddress || typeof ipAddress !== 'string') {
      throw new AppError(400, 'ipAddress is required', 'MISSING_IP_ADDRESS');
    }
    if (typeof success !== 'boolean') {
      throw new AppError(400, 'success (boolean) is required', 'MISSING_SUCCESS');
    }

    const result = await lockoutManager.recordAttempt({
      accountId,
      ipAddress,
      success,
      reason,
      userAgent,
    });

    res.json({ recorded: true, ...result });
  }),
);

// POST /auth/lockout/unlock/:accountId
authLockoutRouter.post(
  '/unlock/:accountId',
  asyncHandler(async (req, res) => {
    const { accountId } = req.params;
    if (!accountId || typeof accountId !== 'string') {
      throw new AppError(400, 'accountId is required', 'MISSING_ACCOUNT_ID');
    }

    const { token } = req.body as { token?: string };

    const unlocked = lockoutManager.unlockAccount(accountId, token);
    if (!unlocked) {
      throw new AppError(
        404,
        'No active lockout found for this account',
        'NOT_LOCKED',
      );
    }

    res.json({ unlocked: true, accountId });
  }),
);

// GET /auth/lockout/attempts
authLockoutRouter.get(
  '/attempts',
  asyncHandler(async (_req, res) => {
    const attempts = lockoutManager.listAttempts();
    res.json({ attempts, total: attempts.length });
  }),
);

// DELETE /auth/lockout/clear/:identifier
authLockoutRouter.delete(
  '/clear/:identifier',
  asyncHandler(async (req, res) => {
    const { identifier } = req.params;
    if (!identifier || typeof identifier !== 'string') {
      throw new AppError(400, 'identifier is required', 'MISSING_IDENTIFIER');
    }

    const parts = identifier.split(':');
    const accountId = parts[0];
    const ipAddress = parts.length >= 2 ? parts.slice(1).join(':') : '0.0.0.0';

    lockoutManager.unlockAccount(accountId);

    res.json({ cleared: true, identifier, accountId, ipAddress });
  }),
);
