/**
 * 2FA Authentication Routes
 * TOTP-based two-factor authentication endpoints
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  generateTOTPSecret,
  confirm2FASetup,
  verify2FAToken,
  disable2FA,
  get2FAStatus,
  getBackupCodes,
  regenerateBackupCodes,
  setup2FA,
  getTwoFactorLogs,
  generateRecoveryToken,
  validateRecoveryToken,
  completeRecovery,
  rememberDevice,
  isDeviceRemembered,
} from '../services/2fa-service.js';
import {
  Setup2FARequestSchema,
  Verify2FARequestSchema,
  Confirm2FASetupRequestSchema,
  Disable2FARequestSchema,
  Get2FAStatusResponseSchema,
  Setup2FAResponseSchema,
  Verify2FAResponseSchema,
  GetBackupCodesRequestSchema,
  RegenerateBackupCodesRequestSchema,
  Get2FALogsRequestSchema,
  RequestRecoveryRequestSchema,
  CompleteRecoveryRequestSchema,
} from '../schemas/2fa.js';

export const twoFactorAuthRouter = Router();

// Helper function for async route handlers
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * POST /api/v1/auth/2fa/setup
 * Initialize TOTP setup for a user
 */
twoFactorAuthRouter.post(
  '/setup',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const body = Setup2FARequestSchema.parse(req.body);
      const { userId } = body;

      // Generate TOTP secret and QR code
      const totpData = await generateTOTPSecret(userId);

      // Store the temporary setup
      await setup2FA(userId, totpData.secret, totpData.backupCodes);

      res.status(200).json({
        secret: totpData.secret,
        qrCode: totpData.qrCode,
        backupCodes: totpData.backupCodes,
      } as z.infer<typeof Setup2FAResponseSchema>);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', details: error.errors });
      } else {
        res.status(500).json({ error: 'Failed to setup 2FA' });
      }
    }
  })
);

/**
 * POST /api/v1/auth/2fa/confirm
 * Confirm 2FA setup by verifying a TOTP token
 */
twoFactorAuthRouter.post(
  '/confirm',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const body = Confirm2FASetupRequestSchema.parse(req.body);
      const { userId, token, backupCodesConfirmed } = body;

      if (!backupCodesConfirmed) {
        res.status(400).json({ error: 'Must confirm backup codes have been saved' });
        return;
      }

      const isValid = confirm2FASetup(userId, token);

      if (!isValid) {
        res.status(400).json({ error: 'Invalid verification token' });
        return;
      }

      res.status(200).json({
        success: true,
        message: '2FA has been successfully enabled',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', details: error.errors });
      } else {
        res.status(500).json({ error: 'Failed to confirm 2FA setup' });
      }
    }
  })
);

/**
 * POST /api/v1/auth/2fa/verify
 * Verify a TOTP token during login
 */
twoFactorAuthRouter.post(
  '/verify',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const body = Verify2FARequestSchema.parse(req.body);
      const { userId, token, rememberDevice: shouldRemember } = body;

      const isBackupCode = token.length > 6;
      const result = verify2FAToken(userId, token, isBackupCode);

      if (!result.success) {
        res.status(401).json({
          success: false,
          message: result.message,
        });
        return;
      }

      let deviceHash: string | undefined;
      if (shouldRemember) {
        const ipAddress = req.ip;
        const userAgent = req.get('user-agent');
        deviceHash = rememberDevice(userId, ipAddress, userAgent);
      }

      res.status(200).json({
        success: true,
        message: result.message,
        backupCodesRemaining: result.backupCodesRemaining,
        deviceHash,
      } as z.infer<typeof Verify2FAResponseSchema>);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', details: error.errors });
      } else {
        res.status(500).json({ error: 'Failed to verify 2FA token' });
      }
    }
  })
);

/**
 * GET /api/v1/auth/2fa/status
 * Get 2FA status for a user
 */
twoFactorAuthRouter.get(
  '/status/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      // Validate userId is a valid UUID
      if (!userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }

      const status = get2FAStatus(userId);

      res.status(200).json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get 2FA status' });
    }
  })
);

/**
 * DELETE /api/v1/auth/2fa
 * Disable 2FA for a user
 */
twoFactorAuthRouter.delete(
  '/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const body = Disable2FARequestSchema.parse({
        userId: req.params.userId,
        ...req.body,
      });

      const { userId, token, reason } = body;

      // Verify the token before allowing disable
      const result = verify2FAToken(userId, token);

      if (!result.success) {
        res.status(401).json({ error: 'Invalid verification token' });
        return;
      }

      const success = disable2FA(userId);

      if (!success) {
        res.status(400).json({ error: '2FA not enabled for this user' });
        return;
      }

      res.status(200).json({
        success: true,
        message: '2FA has been disabled',
        reason: reason || 'User requested',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', details: error.errors });
      } else {
        res.status(500).json({ error: 'Failed to disable 2FA' });
      }
    }
  })
);

/**
 * POST /api/v1/auth/2fa/backup-codes
 * Get backup codes (requires 2FA verification)
 */
twoFactorAuthRouter.post(
  '/backup-codes',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const body = GetBackupCodesRequestSchema.parse(req.body);
      const { userId, token } = body;

      // Verify the token
      const result = verify2FAToken(userId, token);

      if (!result.success) {
        res.status(401).json({ error: 'Invalid verification token' });
        return;
      }

      const backupCodes = getBackupCodes(userId);

      res.status(200).json({
        backupCodes,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', details: error.errors });
      } else {
        res.status(500).json({ error: 'Failed to get backup codes' });
      }
    }
  })
);

/**
 * POST /api/v1/auth/2fa/regenerate-backup-codes
 * Regenerate backup codes
 */
twoFactorAuthRouter.post(
  '/regenerate-backup-codes',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const body = RegenerateBackupCodesRequestSchema.parse(req.body);
      const { userId, token } = body;

      // Verify the token
      const result = verify2FAToken(userId, token);

      if (!result.success) {
        res.status(401).json({ error: 'Invalid verification token' });
        return;
      }

      const newCodes = regenerateBackupCodes(userId);

      res.status(200).json({
        backupCodes: newCodes,
        message: 'Backup codes have been regenerated',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', details: error.errors });
      } else {
        res.status(500).json({ error: 'Failed to regenerate backup codes' });
      }
    }
  })
);

/**
 * GET /api/v1/auth/2fa/logs/:userId
 * Get 2FA logs for a user
 */
twoFactorAuthRouter.get(
  '/logs/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const query = Get2FALogsRequestSchema.parse({
        userId: req.params.userId,
        action: req.query.action,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      });

      const { userId, action, limit, offset } = query;

      const { logs, total } = getTwoFactorLogs(userId, limit, offset, action);

      res.status(200).json({
        logs,
        total,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', details: error.errors });
      } else {
        res.status(500).json({ error: 'Failed to get 2FA logs' });
      }
    }
  })
);

/**
 * POST /api/v1/auth/2fa/recovery
 * Request account recovery
 */
twoFactorAuthRouter.post(
  '/recovery',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const body = RequestRecoveryRequestSchema.parse(req.body);
      const { userId, method } = body;

      const recovery = generateRecoveryToken(userId, method);

      res.status(200).json({
        recoveryToken: recovery.recoveryToken,
        message: `Recovery instructions have been sent via ${method}`,
        expiresIn: RECOVERY_TOKEN_EXPIRY_HOURS,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', details: error.errors });
      } else {
        res.status(500).json({ error: 'Failed to request recovery' });
      }
    }
  })
);

/**
 * POST /api/v1/auth/2fa/complete-recovery
 * Complete account recovery
 */
twoFactorAuthRouter.post(
  '/complete-recovery',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const body = CompleteRecoveryRequestSchema.parse(req.body);
      const { userId, recoveryToken, newSecret } = body;

      const recovery = validateRecoveryToken(recoveryToken);

      if (!recovery || recovery.userId !== userId) {
        res.status(400).json({ error: 'Invalid or expired recovery token' });
        return;
      }

      // If new secret provided, use it; otherwise generate new one
      let secret = newSecret;
      if (!secret) {
        const totpData = await generateTOTPSecret(userId);
        secret = totpData.secret;
      }

      // Setup new 2FA with the secret
      const backupCodes = (await generateTOTPSecret(userId)).backupCodes;
      await setup2FA(userId, secret, backupCodes);

      completeRecovery(recoveryToken);

      res.status(200).json({
        success: true,
        message: 'Account recovery completed successfully',
        requiresVerification: true,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', details: error.errors });
      } else {
        res.status(500).json({ error: 'Failed to complete recovery' });
      }
    }
  })
);

/**
 * POST /api/v1/auth/2fa/check-device
 * Check if device is remembered
 */
twoFactorAuthRouter.post(
  '/check-device',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { userId, deviceHash } = req.body;

      if (!userId || !deviceHash) {
        res.status(400).json({ error: 'userId and deviceHash are required' });
        return;
      }

      const isRemembered = isDeviceRemembered(userId, deviceHash);

      res.status(200).json({
        isRemembered,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to check device' });
    }
  })
);

// Constant for recovery token expiry
const RECOVERY_TOKEN_EXPIRY_HOURS = 24;
