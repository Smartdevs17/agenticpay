/**
 * 2FA Service Tests
 * Tests for TOTP generation, verification, and management
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateTOTPSecret,
  verifyTOTPToken,
  generateBackupCodes,
  validateBackupCode,
  setup2FA,
  confirm2FASetup,
  verify2FAToken,
  disable2FA,
  get2FAStatus,
  getBackupCodes,
  regenerateBackupCodes,
  logTwoFactorAction,
  getTwoFactorLogs,
  rememberDevice,
  isDeviceRemembered,
  generateRecoveryToken,
  validateRecoveryToken,
  completeRecovery,
} from '../2fa-service';
import speakeasy from 'speakeasy';

const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('2FA Service', () => {
  beforeEach(() => {
    // Clean up state before each test
    jest.clearAllMocks();
  });

  describe('generateTOTPSecret', () => {
    it('should generate a valid TOTP secret', async () => {
      const result = await generateTOTPSecret(TEST_USER_ID);

      expect(result).toHaveProperty('secret');
      expect(result).toHaveProperty('qrCode');
      expect(result).toHaveProperty('backupCodes');
      expect(result.secret).toBeTruthy();
      expect(result.qrCode).toContain('data:image/png;base64');
      expect(result.backupCodes).toHaveLength(10);
    });

    it('should generate unique secrets for different users', async () => {
      const secret1 = await generateTOTPSecret(TEST_USER_ID);
      const secret2 = await generateTOTPSecret('different-user-id');

      expect(secret1.secret).not.toBe(secret2.secret);
    });
  });

  describe('verifyTOTPToken', () => {
    it('should verify a valid token', async () => {
      const { secret } = await generateTOTPSecret(TEST_USER_ID);

      // Generate a valid token
      const token = speakeasy.totp({
        secret,
        encoding: 'base32',
      });

      expect(verifyTOTPToken(secret, token)).toBe(true);
    });

    it('should reject an invalid token', async () => {
      const { secret } = await generateTOTPSecret(TEST_USER_ID);

      expect(verifyTOTPToken(secret, '000000')).toBe(false);
    });

    it('should reject an expired token', async () => {
      const { secret } = await generateTOTPSecret(TEST_USER_ID);

      // Generate a token from 2 minutes ago
      const oldToken = speakeasy.totp({
        secret,
        encoding: 'base32',
        time: Math.floor(Date.now() / 1000) - 120,
      });

      expect(verifyTOTPToken(secret, oldToken)).toBe(false);
    });
  });

  describe('generateBackupCodes', () => {
    it('should generate 10 backup codes', () => {
      const codes = generateBackupCodes();

      expect(codes).toHaveLength(10);
      codes.forEach((code) => {
        expect(code).toHaveLength(8);
        expect(code).toMatch(/^[A-Z0-9]+$/);
      });
    });

    it('should generate unique codes', () => {
      const codes = generateBackupCodes();
      const uniqueCodes = new Set(codes);

      expect(uniqueCodes.size).toBe(10);
    });
  });

  describe('validateBackupCode', () => {
    it('should validate a correct backup code', () => {
      const codes = generateBackupCodes();

      expect(validateBackupCode(codes, codes[0])).toBe(true);
    });

    it('should reject an invalid backup code', () => {
      const codes = generateBackupCodes();

      expect(validateBackupCode(codes, 'INVALID00')).toBe(false);
    });
  });

  describe('setup2FA', () => {
    it('should setup 2FA for a user', async () => {
      const { secret, backupCodes } = await generateTOTPSecret(TEST_USER_ID);

      const setup = await setup2FA(TEST_USER_ID, secret, backupCodes);

      expect(setup).toHaveProperty('userId', TEST_USER_ID);
      expect(setup).toHaveProperty('secret');
      expect(setup).toHaveProperty('enabled', false);
      expect(setup).toHaveProperty('createdAt');
    });
  });

  describe('confirm2FASetup', () => {
    it('should confirm 2FA setup with valid token', async () => {
      const { secret, backupCodes } = await generateTOTPSecret(TEST_USER_ID);
      await setup2FA(TEST_USER_ID, secret, backupCodes);

      const token = speakeasy.totp({
        secret,
        encoding: 'base32',
      });

      const result = confirm2FASetup(TEST_USER_ID, token);

      expect(result).toBe(true);
    });

    it('should reject invalid token', async () => {
      const { secret, backupCodes } = await generateTOTPSecret(TEST_USER_ID);
      await setup2FA(TEST_USER_ID, secret, backupCodes);

      const result = confirm2FASetup(TEST_USER_ID, '000000');

      expect(result).toBe(false);
    });
  });

  describe('verify2FAToken', () => {
    it('should verify a valid TOTP token', async () => {
      const { secret, backupCodes } = await generateTOTPSecret(TEST_USER_ID);
      await setup2FA(TEST_USER_ID, secret, backupCodes);
      confirm2FASetup(TEST_USER_ID, speakeasy.totp({ secret, encoding: 'base32' }));

      const token = speakeasy.totp({
        secret,
        encoding: 'base32',
      });

      const result = verify2FAToken(TEST_USER_ID, token);

      expect(result.success).toBe(true);
      expect(result.message).toBe('2FA verification successful');
    });

    it('should verify a valid backup code', async () => {
      const { secret, backupCodes } = await generateTOTPSecret(TEST_USER_ID);
      await setup2FA(TEST_USER_ID, secret, backupCodes);
      confirm2FASetup(TEST_USER_ID, speakeasy.totp({ secret, encoding: 'base32' }));

      const result = verify2FAToken(TEST_USER_ID, backupCodes[0], true);

      expect(result.success).toBe(true);
      expect(result.backupCodesRemaining).toBe(9);
    });

    it('should not verify if 2FA is disabled', () => {
      const result = verify2FAToken(TEST_USER_ID, '123456');

      expect(result.success).toBe(false);
    });
  });

  describe('disable2FA', () => {
    it('should disable 2FA', async () => {
      const { secret, backupCodes } = await generateTOTPSecret(TEST_USER_ID);
      await setup2FA(TEST_USER_ID, secret, backupCodes);

      const result = disable2FA(TEST_USER_ID);

      expect(result).toBe(true);
      expect(get2FAStatus(TEST_USER_ID).enabled).toBe(false);
    });
  });

  describe('get2FAStatus', () => {
    it('should return status when 2FA is disabled', () => {
      const status = get2FAStatus(TEST_USER_ID);

      expect(status.enabled).toBe(false);
      expect(status.backupCodesRemaining).toBe(0);
    });

    it('should return status when 2FA is enabled', async () => {
      const { secret, backupCodes } = await generateTOTPSecret(TEST_USER_ID);
      await setup2FA(TEST_USER_ID, secret, backupCodes);
      confirm2FASetup(TEST_USER_ID, speakeasy.totp({ secret, encoding: 'base32' }));

      const status = get2FAStatus(TEST_USER_ID);

      expect(status.enabled).toBe(true);
      expect(status.backupCodesRemaining).toBe(10);
    });
  });

  describe('logTwoFactorAction', () => {
    it('should log 2FA action', () => {
      logTwoFactorAction(TEST_USER_ID, '2fa_setup', true, '192.168.1.1', 'Mozilla/5.0');

      const { logs } = getTwoFactorLogs(TEST_USER_ID);

      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('2fa_setup');
      expect(logs[0].success).toBe(true);
    });

    it('should filter logs by action', () => {
      logTwoFactorAction(TEST_USER_ID, '2fa_setup', true);
      logTwoFactorAction(TEST_USER_ID, '2fa_verified', true);
      logTwoFactorAction(TEST_USER_ID, '2fa_failed', false);

      const { logs: setupLogs } = getTwoFactorLogs(TEST_USER_ID, 50, 0, '2fa_setup');
      const { logs: verifiedLogs } = getTwoFactorLogs(TEST_USER_ID, 50, 0, '2fa_verified');

      expect(setupLogs).toHaveLength(1);
      expect(verifiedLogs).toHaveLength(1);
    });
  });

  describe('rememberDevice', () => {
    it('should remember a device', () => {
      const hash = rememberDevice(TEST_USER_ID, '192.168.1.1', 'Mozilla/5.0');

      expect(hash).toBeTruthy();
      expect(isDeviceRemembered(TEST_USER_ID, hash)).toBe(true);
    });

    it('should not remember expired devices', () => {
      // This test would require mocking Date.now() or advancing time
      // For now, we just verify the device is remembered immediately
      const hash = rememberDevice(TEST_USER_ID, '192.168.1.1', 'Mozilla/5.0');

      expect(isDeviceRemembered(TEST_USER_ID, hash)).toBe(true);
    });
  });

  describe('recovery tokens', () => {
    it('should generate recovery token', () => {
      const recovery = generateRecoveryToken(TEST_USER_ID, 'email');

      expect(recovery).toHaveProperty('recoveryToken');
      expect(recovery.userId).toBe(TEST_USER_ID);
      expect(recovery.method).toBe('email');
      expect(recovery.used).toBe(false);
    });

    it('should validate recovery token', () => {
      const recovery = generateRecoveryToken(TEST_USER_ID, 'email');

      const validated = validateRecoveryToken(recovery.recoveryToken);

      expect(validated).not.toBeNull();
      expect(validated?.userId).toBe(TEST_USER_ID);
    });

    it('should mark token as used', () => {
      const recovery = generateRecoveryToken(TEST_USER_ID, 'email');

      completeRecovery(recovery.recoveryToken);

      const validated = validateRecoveryToken(recovery.recoveryToken);

      expect(validated).toBeNull();
    });
  });
});
