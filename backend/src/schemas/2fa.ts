/**
 * 2FA (Two-Factor Authentication) Zod Schemas
 * Request/response validation for 2FA endpoints
 */

import { z } from 'zod';

// Setup 2FA request
export const Setup2FARequestSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});

export type Setup2FARequest = z.infer<typeof Setup2FARequestSchema>;

// Verify 2FA request
export const Verify2FARequestSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  token: z.string()
    .length(6, 'Token must be 6 digits')
    .regex(/^\d{6}$/, 'Token must contain only digits'),
  rememberDevice: z.boolean().optional(),
});

export type Verify2FARequest = z.infer<typeof Verify2FARequestSchema>;

// Confirm 2FA setup request
export const Confirm2FASetupRequestSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  token: z.string()
    .length(6, 'Token must be 6 digits')
    .regex(/^\d{6}$/, 'Token must contain only digits'),
  backupCodesConfirmed: z.boolean('Must confirm backup codes saved'),
});

export type Confirm2FASetupRequest = z.infer<typeof Confirm2FASetupRequestSchema>;

// Disable 2FA request
export const Disable2FARequestSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  token: z.string()
    .length(6, 'Token must be 6 digits')
    .regex(/^\d{6}$/, 'Token must contain only digits'),
  reason: z.string().optional(),
});

export type Disable2FARequest = z.infer<typeof Disable2FARequestSchema>;

// Get 2FA status response
export const Get2FAStatusResponseSchema = z.object({
  enabled: z.boolean(),
  verifiedAt: z.date().optional(),
  lastUsedAt: z.date().optional(),
  backupCodesRemaining: z.number().nonnegative(),
});

export type Get2FAStatusResponse = z.infer<typeof Get2FAStatusResponseSchema>;

// Setup 2FA response
export const Setup2FAResponseSchema = z.object({
  secret: z.string(),
  qrCode: z.string(),
  backupCodes: z.array(z.string()),
});

export type Setup2FAResponse = z.infer<typeof Setup2FAResponseSchema>;

// Verify 2FA response
export const Verify2FAResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  backupCodesRemaining: z.number().optional(),
});

export type Verify2FAResponse = z.infer<typeof Verify2FAResponseSchema>;

// Backup codes request
export const GetBackupCodesRequestSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  token: z.string()
    .length(6, 'Token must be 6 digits')
    .regex(/^\d{6}$/, 'Token must contain only digits'),
});

export type GetBackupCodesRequest = z.infer<typeof GetBackupCodesRequestSchema>;

// Regenerate backup codes request
export const RegenerateBackupCodesRequestSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  token: z.string()
    .length(6, 'Token must be 6 digits')
    .regex(/^\d{6}$/, 'Token must contain only digits'),
});

export type RegenerateBackupCodesRequest = z.infer<typeof RegenerateBackupCodesRequestSchema>;

// Backup codes response
export const BackupCodesResponseSchema = z.object({
  backupCodes: z.array(z.string()),
});

export type BackupCodesResponse = z.infer<typeof BackupCodesResponseSchema>;

// 2FA logs filter
export const Get2FALogsRequestSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  action: z.enum(['2fa_setup', '2fa_verified', '2fa_failed', '2fa_backup_used', '2fa_disabled']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type Get2FALogsRequest = z.infer<typeof Get2FALogsRequestSchema>;

// 2FA logs response
export const Get2FALogsResponseSchema = z.object({
  logs: z.array(
    z.object({
      id: z.string(),
      action: z.enum(['2fa_setup', '2fa_verified', '2fa_failed', '2fa_backup_used', '2fa_disabled']),
      success: z.boolean(),
      ipAddress: z.string().optional(),
      userAgent: z.string().optional(),
      backupCodeUsed: z.boolean().optional(),
      createdAt: z.date(),
    })
  ),
  total: z.number(),
});

export type Get2FALogsResponse = z.infer<typeof Get2FALogsResponseSchema>;

// Recovery request
export const RequestRecoveryRequestSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  method: z.enum(['email', 'support_ticket']),
});

export type RequestRecoveryRequest = z.infer<typeof RequestRecoveryRequestSchema>;

// Recovery response
export const RequestRecoveryResponseSchema = z.object({
  recoveryToken: z.string(),
  message: z.string(),
});

export type RequestRecoveryResponse = z.infer<typeof RequestRecoveryResponseSchema>;

// Complete recovery request
export const CompleteRecoveryRequestSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  recoveryToken: z.string(),
  newSecret: z.string().optional(),
});

export type CompleteRecoveryRequest = z.infer<typeof CompleteRecoveryRequestSchema>;
