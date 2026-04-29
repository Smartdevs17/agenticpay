/**
 * Frontend 2FA Types
 */

export interface TwoFactorSetupData {
  secret: string;
  qrCode: string;
  backupCodes: string[];
}

export interface TwoFactorStatus {
  enabled: boolean;
  verifiedAt?: string;
  lastUsedAt?: string;
  backupCodesRemaining: number;
}

export interface TwoFactorLog {
  id: string;
  action: '2fa_setup' | '2fa_verified' | '2fa_failed' | '2fa_backup_used' | '2fa_disabled';
  success: boolean;
  ipAddress?: string;
  userAgent?: string;
  backupCodeUsed?: boolean;
  createdAt: string;
}

export interface VerificationResponse {
  success: boolean;
  message: string;
  backupCodesRemaining?: number;
  deviceHash?: string;
}

export interface RecoveryInitiation {
  recoveryToken: string;
  message: string;
  expiresIn: number;
}
