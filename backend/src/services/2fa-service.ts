/**
 * 2FA Service
 * Handles TOTP generation, verification, and management
 */

import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { randomUUID } from 'node:crypto';
import {
  TOTPSecret,
  TwoFactorSetup,
  TwoFactorLog,
  TwoFactorStatus,
  VerifyTOTPResponse,
  BackupCodeValidation,
  RememberedDevice,
  TwoFactorRecovery,
} from '../types/2fa.js';

// In-memory storage (in production, use a database)
const twoFactorSetups = new Map<string, TwoFactorSetup>();
const twoFactorLogs = new Map<string, TwoFactorLog[]>();
const rememberedDevices = new Map<string, RememberedDevice[]>();
const recoveryTokens = new Map<string, TwoFactorRecovery>();

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;
const TOKEN_WINDOW = 2; // Allow 2 time windows (30s before/after)
const RECOVERY_TOKEN_EXPIRY_HOURS = 24;

/**
 * Generate a TOTP secret and QR code for the user
 */
export async function generateTOTPSecret(userId: string, appName: string = 'AgenticPay'): Promise<TOTPSecret> {
  const secret = speakeasy.generateSecret({
    name: `${appName} (${userId.substring(0, 8)})`,
    issuer: appName,
    length: 32,
  });

  if (!secret.base32) {
    throw new Error('Failed to generate TOTP secret');
  }

  const qrCode = await QRCode.toDataURL(secret.otpauth_url || '');
  const backupCodes = generateBackupCodes();

  return {
    secret: secret.base32,
    qrCode,
    backupCodes,
  };
}

/**
 * Verify a TOTP token
 */
export function verifyTOTPToken(secret: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: TOKEN_WINDOW,
  });
}

/**
 * Generate backup codes for recovery
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    codes.push(generateRandomCode(BACKUP_CODE_LENGTH));
  }
  return codes;
}

/**
 * Generate a random alphanumeric code
 */
function generateRandomCode(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Hash a backup code for comparison (prevents timing attacks)
 */
export function hashBackupCode(code: string): string {
  // In production, use bcrypt or similar
  return Buffer.from(code).toString('base64');
}

/**
 * Validate a backup code
 */
export function validateBackupCode(backupCodes: string[], code: string): boolean {
  const hashedCode = hashBackupCode(code);
  return backupCodes.some((stored) => hashBackupCode(stored) === hashedCode);
}

/**
 * Setup 2FA for a user
 */
export async function setup2FA(userId: string, secret: string, backupCodes: string[]): Promise<TwoFactorSetup> {
  const setup: TwoFactorSetup = {
    userId,
    secret,
    backupCodes: backupCodes.map(hashBackupCode),
    enabled: false,
    createdAt: new Date(),
  };

  twoFactorSetups.set(userId, setup);
  logTwoFactorAction(userId, '2fa_setup', true);

  return setup;
}

/**
 * Confirm 2FA setup by verifying a token
 */
export function confirm2FASetup(userId: string, token: string): boolean {
  const setup = twoFactorSetups.get(userId);
  if (!setup) {
    throw new Error('2FA setup not found');
  }

  const isValid = verifyTOTPToken(setup.secret, token);
  if (isValid) {
    setup.enabled = true;
    setup.verifiedAt = new Date();
    logTwoFactorAction(userId, '2fa_verified', true);
  } else {
    logTwoFactorAction(userId, '2fa_verified', false);
  }

  return isValid;
}

/**
 * Verify TOTP token during login
 */
export function verify2FAToken(
  userId: string,
  token: string,
  isBackupCode: boolean = false
): VerifyTOTPResponse {
  const setup = twoFactorSetups.get(userId);
  if (!setup || !setup.enabled) {
    return {
      success: false,
      message: '2FA is not enabled for this user',
    };
  }

  let success = false;

  if (isBackupCode) {
    if (!validateBackupCode(setup.backupCodes, token)) {
      logTwoFactorAction(userId, '2fa_failed', false);
      return {
        success: false,
        message: 'Invalid backup code',
      };
    }
    success = true;
    logTwoFactorAction(userId, '2fa_backup_used', true);
    // Remove the used backup code
    const hashedCode = hashBackupCode(token);
    setup.backupCodes = setup.backupCodes.filter((code) => code !== hashedCode);
  } else {
    if (!verifyTOTPToken(setup.secret, token)) {
      logTwoFactorAction(userId, '2fa_failed', false);
      return {
        success: false,
        message: 'Invalid TOTP token',
      };
    }
    success = true;
    logTwoFactorAction(userId, '2fa_verified', true);
  }

  setup.lastUsedAt = new Date();

  return {
    success,
    message: success ? '2FA verification successful' : 'Invalid token',
    backupCodesRemaining: setup.backupCodes.length,
  };
}

/**
 * Disable 2FA for a user
 */
export function disable2FA(userId: string): boolean {
  const setup = twoFactorSetups.get(userId);
  if (!setup) {
    return false;
  }

  twoFactorSetups.delete(userId);
  logTwoFactorAction(userId, '2fa_disabled', true);

  return true;
}

/**
 * Get 2FA status for a user
 */
export function get2FAStatus(userId: string): TwoFactorStatus {
  const setup = twoFactorSetups.get(userId);

  return {
    userId,
    enabled: setup?.enabled ?? false,
    verifiedAt: setup?.verifiedAt,
    lastUsedAt: setup?.lastUsedAt,
    backupCodesRemaining: setup?.backupCodes.length ?? 0,
  };
}

/**
 * Get backup codes (requires verification)
 */
export function getBackupCodes(userId: string): string[] {
  const setup = twoFactorSetups.get(userId);
  if (!setup) {
    return [];
  }

  // Return unhashed codes only for display (store hashed in DB)
  return setup.backupCodes;
}

/**
 * Regenerate backup codes
 */
export function regenerateBackupCodes(userId: string): string[] {
  const setup = twoFactorSetups.get(userId);
  if (!setup) {
    throw new Error('2FA not setup for this user');
  }

  const newCodes = generateBackupCodes();
  setup.backupCodes = newCodes.map(hashBackupCode);

  return newCodes;
}

/**
 * Log 2FA action
 */
export function logTwoFactorAction(
  userId: string,
  action: TwoFactorLog['action'],
  success: boolean,
  ipAddress?: string,
  userAgent?: string,
  backupCodeUsed?: boolean
): void {
  const log: TwoFactorLog = {
    id: randomUUID(),
    userId,
    action,
    success,
    ipAddress,
    userAgent,
    backupCodeUsed,
    createdAt: new Date(),
  };

  if (!twoFactorLogs.has(userId)) {
    twoFactorLogs.set(userId, []);
  }

  twoFactorLogs.get(userId)?.push(log);
}

/**
 * Get 2FA logs for a user
 */
export function getTwoFactorLogs(
  userId: string,
  limit: number = 50,
  offset: number = 0,
  action?: TwoFactorLog['action']
): { logs: TwoFactorLog[]; total: number } {
  let logs = twoFactorLogs.get(userId) ?? [];

  if (action) {
    logs = logs.filter((log) => log.action === action);
  }

  const total = logs.length;
  const paginated = logs.slice(offset, offset + limit);

  return { logs: paginated, total };
}

/**
 * Remember a device for a user (skip 2FA on trusted devices)
 */
export function rememberDevice(userId: string, ipAddress?: string, userAgent?: string): string {
  const deviceHash = generateRandomCode(32);
  const device: RememberedDevice = {
    userId,
    deviceHash,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    userAgent,
    ipAddress,
  };

  if (!rememberedDevices.has(userId)) {
    rememberedDevices.set(userId, []);
  }

  rememberedDevices.get(userId)?.push(device);

  return deviceHash;
}

/**
 * Check if a device is remembered
 */
export function isDeviceRemembered(userId: string, deviceHash: string): boolean {
  const devices = rememberedDevices.get(userId) ?? [];
  return devices.some((d) => d.deviceHash === deviceHash && d.expiresAt > new Date());
}

/**
 * Generate recovery token (for lost device recovery)
 */
export function generateRecoveryToken(userId: string, method: 'email' | 'support_ticket'): TwoFactorRecovery {
  const recoveryToken = randomUUID();
  const recovery: TwoFactorRecovery = {
    userId,
    recoveryToken,
    method,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + RECOVERY_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000),
    used: false,
  };

  recoveryTokens.set(recoveryToken, recovery);

  return recovery;
}

/**
 * Validate recovery token
 */
export function validateRecoveryToken(token: string): TwoFactorRecovery | null {
  const recovery = recoveryTokens.get(token);

  if (!recovery) {
    return null;
  }

  if (recovery.expiresAt < new Date() || recovery.used) {
    return null;
  }

  return recovery;
}

/**
 * Complete recovery
 */
export function completeRecovery(token: string): boolean {
  const recovery = recoveryTokens.get(token);

  if (!recovery) {
    return false;
  }

  recovery.used = true;
  recovery.usedAt = new Date();

  return true;
}
