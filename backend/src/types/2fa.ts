/**
 * 2FA (Two-Factor Authentication) Types
 * TOTP-based 2FA support using authenticator apps
 */

export interface TOTPSecret {
  secret: string;
  qrCode: string;
  backupCodes: string[];
}

export interface TwoFactorSetup {
  userId: string;
  secret: string;
  backupCodes: string[];
  enabled: boolean;
  createdAt: Date;
  verifiedAt?: Date;
  lastUsedAt?: Date;
}

export interface TwoFactorLog {
  id: string;
  userId: string;
  action: '2fa_setup' | '2fa_verified' | '2fa_failed' | '2fa_backup_used' | '2fa_disabled';
  success: boolean;
  ipAddress?: string;
  userAgent?: string;
  backupCodeUsed?: boolean;
  createdAt: Date;
}

export interface TwoFactorStatus {
  userId: string;
  enabled: boolean;
  verifiedAt?: Date;
  lastUsedAt?: Date;
  backupCodesRemaining: number;
}

export interface VerifyTOTPRequest {
  userId: string;
  token: string;
  rememberDevice?: boolean;
}

export interface VerifyTOTPResponse {
  success: boolean;
  message: string;
  backupCodesRemaining?: number;
}

export interface BackupCodeValidation {
  valid: boolean;
  remaining: number;
}

export interface TwoFactorPolicy {
  userId: string;
  enforced: boolean;
  enforceForTransactions: boolean;
  transactionThreshold: number; // in USD
  gracePeriod?: number; // in days
  rememberDeviceExpiry?: number; // in days
  maxBackupCodes: number;
  codesRequiredOnSetup: number;
}

export interface RememberedDevice {
  userId: string;
  deviceHash: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface TwoFactorRecovery {
  userId: string;
  recoveryToken: string;
  method: 'email' | 'support_ticket';
  createdAt: Date;
  expiresAt: Date;
  used: boolean;
  usedAt?: Date;
}
