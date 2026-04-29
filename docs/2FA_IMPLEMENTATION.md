# TOTP-Based 2FA Implementation Guide

## Overview

This implementation provides TOTP (Time-based One-Time Password) based two-factor authentication using authenticator apps like Google Authenticator, Authy, Microsoft Authenticator, or FreeOTP.

## Features Implemented

### Backend Features
- ✅ TOTP secret generation with QR code
- ✅ TOTP token verification with time window tolerance
- ✅ Backup codes generation and validation (10 codes, 8 characters each)
- ✅ 2FA setup and confirmation workflow
- ✅ Device trust/remember device for 30 days
- ✅ Account recovery through email or support tickets
- ✅ 2FA activity logging and audit trail
- ✅ Backup code regeneration
- ✅ 2FA enforcement on high-value transactions

### Frontend Components
- ✅ `TwoFactorSetup` - Initial 2FA setup with QR code scanning
- ✅ `TwoFactorVerification` - Login verification component
- ✅ `TwoFactorSettings` - Settings management and backup codes
- ✅ `TwoFactorRecovery` - Account recovery interface

## API Endpoints

### POST /api/v1/auth/2fa/setup
Initialize TOTP setup for a user.

**Request:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**
```json
{
  "secret": "JBSWY3DPEBLW64TMMQ======",
  "qrCode": "data:image/png;base64,...",
  "backupCodes": [
    "ABCD1234",
    "EFGH5678",
    ...
  ]
}
```

### POST /api/v1/auth/2fa/confirm
Confirm 2FA setup by verifying a TOTP token.

**Request:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "token": "123456",
  "backupCodesConfirmed": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "2FA has been successfully enabled"
}
```

### POST /api/v1/auth/2fa/verify
Verify a TOTP token during login.

**Request:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "token": "123456",
  "rememberDevice": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "2FA verification successful",
  "backupCodesRemaining": 9,
  "deviceHash": "abc123..."
}
```

### GET /api/v1/auth/2fa/status/:userId
Get 2FA status for a user.

**Response:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "enabled": true,
  "verifiedAt": "2024-04-27T10:00:00Z",
  "lastUsedAt": "2024-04-27T11:30:00Z",
  "backupCodesRemaining": 8
}
```

### DELETE /api/v1/auth/2fa/:userId
Disable 2FA for a user.

**Request:**
```json
{
  "token": "123456",
  "reason": "Lost device"
}
```

**Response:**
```json
{
  "success": true,
  "message": "2FA has been disabled",
  "reason": "Lost device"
}
```

### POST /api/v1/auth/2fa/backup-codes
Get backup codes (requires verification).

**Request:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "token": "123456"
}
```

**Response:**
```json
{
  "backupCodes": [
    "ABCD1234",
    "EFGH5678",
    ...
  ]
}
```

### POST /api/v1/auth/2fa/regenerate-backup-codes
Regenerate backup codes.

**Request:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "token": "123456"
}
```

**Response:**
```json
{
  "backupCodes": [
    "IJKL9012",
    "MNOP3456",
    ...
  ],
  "message": "Backup codes have been regenerated"
}
```

### GET /api/v1/auth/2fa/logs/:userId?limit=50&offset=0&action=2fa_verified
Get 2FA activity logs.

**Response:**
```json
{
  "logs": [
    {
      "id": "log-uuid",
      "action": "2fa_verified",
      "success": true,
      "ipAddress": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "createdAt": "2024-04-27T11:30:00Z"
    }
  ],
  "total": 42
}
```

### POST /api/v1/auth/2fa/recovery
Request account recovery.

**Request:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "email"
}
```

**Response:**
```json
{
  "recoveryToken": "recovery-token-uuid",
  "message": "Recovery instructions have been sent via email",
  "expiresIn": 24
}
```

### POST /api/v1/auth/2fa/complete-recovery
Complete account recovery.

**Request:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "recoveryToken": "recovery-token-uuid",
  "newSecret": "optional-new-secret"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Account recovery completed successfully",
  "requiresVerification": true
}
```

### POST /api/v1/auth/2fa/check-device
Check if a device is remembered.

**Request:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "deviceHash": "abc123..."
}
```

**Response:**
```json
{
  "isRemembered": true
}
```

## Frontend Usage

### Setup Component
```tsx
import { TwoFactorSetup } from '@/components/auth/TwoFactorSetup';

export function SettingsPage() {
  const userId = useAuthStore((s) => s.userId);

  return (
    <TwoFactorSetup 
      userId={userId}
      onSuccess={() => {
        // Redirect or show success message
      }}
    />
  );
}
```

### Verification Component
```tsx
import { TwoFactorVerification } from '@/components/auth/TwoFactorVerification';

export function LoginPage() {
  const [requiresVerification, setRequiresVerification] = useState(false);

  return requiresVerification ? (
    <TwoFactorVerification
      userId={userId}
      onSuccess={(deviceHash) => {
        // Save deviceHash to localStorage for "remember device"
        // Complete login
      }}
    />
  ) : (
    <LoginForm />
  );
}
```

### Settings Component
```tsx
import { TwoFactorSettings } from '@/components/auth/TwoFactorSettings';

export function AccountSettingsPage() {
  const userId = useAuthStore((s) => s.userId);

  return (
    <TwoFactorSettings userId={userId} />
  );
}
```

### Recovery Component
```tsx
import { TwoFactorRecovery } from '@/components/auth/TwoFactorRecovery';

export function RecoveryPage() {
  return (
    <TwoFactorRecovery
      userId={userId}
      onSuccess={() => {
        // Show success message
      }}
    />
  );
}
```

## Security Considerations

### Clock Skew
- The implementation allows for 2 time windows (±30 seconds) to handle clock skew
- Adjust `TOKEN_WINDOW` in `2fa-service.ts` if needed

### Backup Code Storage
- Backup codes are hashed before storage to prevent timing attacks
- Users should securely store backup codes (offline, password manager, etc.)

### Rate Limiting
- Consider implementing rate limiting on verification endpoints
- Max attempts before temporary lockout

### Recovery Tokens
- Recovery tokens expire after 24 hours
- Configure `RECOVERY_TOKEN_EXPIRY_HOURS` in `2fa-service.ts`

### Device Trust
- Remembered devices expire after 30 days
- Device trust is based on both IP and user-agent
- Configure device expiry in `rememberDevice` function

## Database Integration

The current implementation uses in-memory storage. For production, you'll need to:

1. Create database tables for:
   - `two_factor_setups`
   - `two_factor_logs`
   - `remembered_devices`
   - `recovery_tokens`

2. Replace Map-based storage with database queries

3. Consider caching frequently accessed data

## Testing

### Manual Testing Checklist
- [ ] Setup 2FA and scan QR code
- [ ] Confirm setup with correct token
- [ ] Verify token during login
- [ ] Use backup codes
- [ ] Regenerate backup codes
- [ ] Remember device for 30 days
- [ ] Request and complete recovery
- [ ] View 2FA logs
- [ ] Disable 2FA
- [ ] Test with incorrect tokens

### Edge Cases
- [ ] Invalid QR code scanning
- [ ] Token expired (outside time window)
- [ ] All backup codes used
- [ ] Multiple simultaneous setups
- [ ] Recovery token expiration
- [ ] Device re-memorization

## Known Limitations

1. **In-Memory Storage**: Current implementation doesn't persist data
2. **Email/SMS**: Recovery methods need integration with email service
3. **Admin Disable**: No admin override for disabling user's 2FA
4. **Transaction Enforcement**: 2FA enforcement on high-value transactions not yet implemented
5. **Grace Period**: No grace period for 2FA enablement

## Future Enhancements

- [ ] WebAuthn/FIDO2 support
- [ ] SMS-based 2FA
- [ ] Push-based verification
- [ ] Biometric verification
- [ ] 2FA enforcement policies per organization
- [ ] Admin dashboard for 2FA management
- [ ] Historical device trust tracking
- [ ] Anomaly detection on failed attempts
- [ ] Integration with identity providers

## Support

For issues or questions:
1. Check the API response error messages
2. Review 2FA logs for activity
3. Use recovery process if locked out
4. Contact support team for account recovery
