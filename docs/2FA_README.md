# 2FA Feature - TOTP-Based Two-Factor Authentication

## Quick Start

### 1. Install Dependencies
Dependencies have been added to `backend/package.json`:
- `speakeasy` - TOTP generation and verification
- `qrcode` - QR code generation
- `@types/speakeasy` - TypeScript types

Install with:
```bash
cd backend && npm install
```

### 2. Backend Integration

The backend 2FA router is already integrated into `src/index.ts`:
```typescript
apiV1Router.use('/auth/2fa', twoFactorAuthRouter);
```

All endpoints are available at `/api/v1/auth/2fa/*`

### 3. Frontend Integration

Use the provided components in your application:

#### Setup Screen
```tsx
import { TwoFactorSetup } from '@/components/auth/TwoFactorSetup';

<TwoFactorSetup userId={userId} onSuccess={() => /* redirect */} />
```

#### Login Verification
```tsx
import { TwoFactorVerification } from '@/components/auth/TwoFactorVerification';

<TwoFactorVerification userId={userId} onSuccess={(deviceHash) => /* complete login */} />
```

#### Settings Page
```tsx
import { TwoFactorSettings } from '@/components/auth/TwoFactorSettings';

<TwoFactorSettings userId={userId} />
```

#### Account Recovery
```tsx
import { TwoFactorRecovery } from '@/components/auth/TwoFactorRecovery';

<TwoFactorRecovery userId={userId} onSuccess={() => /* redirect */} />
```

## File Structure

### Backend
```
backend/src/
├── services/
│   ├── 2fa-service.ts          # Core 2FA logic
│   └── __tests__/
│       └── 2fa-service.test.ts # Service tests
├── routes/
│   ├── 2fa.ts                  # API endpoints
│   └── __tests__/
│       └── 2fa.test.ts         # Route tests
├── schemas/
│   └── 2fa.ts                  # Zod validation schemas
├── types/
│   └── 2fa.ts                  # TypeScript types
```

### Frontend
```
frontend/
├── components/auth/
│   ├── TwoFactorSetup.tsx       # Setup component
│   ├── TwoFactorVerification.tsx # Verification component
│   ├── TwoFactorSettings.tsx     # Settings component
│   └── TwoFactorRecovery.tsx     # Recovery component
├── lib/hooks/
│   └── use2fa.ts                # API hooks
├── types/
│   └── 2fa.ts                   # TypeScript types
```

### Documentation
```
docs/
└── 2FA_IMPLEMENTATION.md        # Complete API documentation
```

## Configuration

### Backend Configuration
In `backend/src/services/2fa-service.ts`, adjust these constants:

```typescript
// Time window for token verification (±30s)
const TOKEN_WINDOW = 2;

// Number of backup codes
const BACKUP_CODE_COUNT = 10;

// Backup code length
const BACKUP_CODE_LENGTH = 8;

// Recovery token expiry in hours
const RECOVERY_TOKEN_EXPIRY_HOURS = 24;
```

### Frontend Configuration
In `frontend/lib/hooks/use2fa.ts`, set the API URL:

```typescript
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
```

## Usage Flow

### User Setup
1. User navigates to settings
2. Clicks "Enable 2FA"
3. Selects an authenticator app
4. Component generates QR code
5. User scans QR code with authenticator app
6. User enters 6-digit code to confirm
7. User saves backup codes
8. 2FA is enabled

### Login with 2FA
1. User enters credentials
2. If 2FA enabled, verification prompt appears
3. User enters 6-digit code from authenticator app
4. Or can use backup code if needed
5. Option to "trust this device" for 30 days
6. Login completes

### Account Recovery
1. User clicks "Can't access your authenticator app?"
2. Chooses recovery method (email or support ticket)
3. Recovery instructions sent
4. User completes verification
5. New authenticator setup required

## Testing

### Run Tests
```bash
# Backend tests
cd backend
npm test

# Specifically 2FA tests
npm test -- 2fa
```

### Manual Testing
1. Create a new user account
2. Navigate to security settings
3. Enable 2FA and scan QR code
4. Try logging out and back in with 2FA
5. Test backup codes
6. Test recovery process

## Security Features

- ✅ **Time-based verification** - TOTP with 60-second window and ±30s tolerance
- ✅ **Backup codes** - 10 codes for emergency access
- ✅ **Device trust** - Optional 30-day device memorization
- ✅ **Activity logging** - Complete audit trail of 2FA actions
- ✅ **Recovery flow** - Account recovery without authenticator app
- ✅ **Rate limiting** - (Implement in middleware)
- ✅ **Code hashing** - Backup codes stored as hashes

## Known Limitations & TODOs

- **In-Memory Storage**: Currently stores in memory. Need database integration
- **Email Service**: Recovery emails not yet sent (integrate with email provider)
- **Admin Controls**: No admin override capability yet
- **Rate Limiting**: Implement rate limiting on verification attempts
- **Transaction Enforcement**: 2FA not yet enforced for high-value transactions
- **Grace Period**: No grace period for 2FA enablement

## Future Enhancements

- [ ] WebAuthn/FIDO2 support for hardware keys
- [ ] SMS-based 2FA fallback
- [ ] Push-based verification
- [ ] Biometric verification options
- [ ] Admin dashboard for 2FA management
- [ ] Organization-wide 2FA policies
- [ ] Device fingerprinting improvements
- [ ] Anomaly detection and alerts
- [ ] Integration with identity providers (Auth0, etc.)

## Troubleshooting

### QR Code Not Scanning
- Ensure adequate lighting
- Try a different authenticator app
- Enter the secret key manually from the app (shown below QR code)

### Lost Access to Authenticator App
1. Use backup codes if available
2. Use account recovery feature
3. Contact support for manual verification

### Time Sync Issues
- Check device time synchronization
- Allow time window tolerance (±30 seconds already enabled)
- Manual time adjustment on device

### Backup Codes Running Low
- Regenerate backup codes from settings
- Save new codes securely

## API Documentation

For complete API documentation, see [2FA_IMPLEMENTATION.md](./2FA_IMPLEMENTATION.md)

### Quick API Examples

**Setup 2FA:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/2fa/setup \
  -H "Content-Type: application/json" \
  -d '{"userId":"550e8400-e29b-41d4-a716-446655440000"}'
```

**Verify Token:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/2fa/verify \
  -H "Content-Type: application/json" \
  -d '{"userId":"550e8400-e29b-41d4-a716-446655440000","token":"123456"}'
```

**Get Status:**
```bash
curl http://localhost:3000/api/v1/auth/2fa/status/550e8400-e29b-41d4-a716-446655440000
```

## Support

For issues or questions:
1. Check error messages in the UI
2. Review 2FA logs for activity
3. Check browser console for client-side errors
4. Review server logs for backend errors
5. Refer to [2FA_IMPLEMENTATION.md](./2FA_IMPLEMENTATION.md) for detailed documentation

## Contributing

When making changes to 2FA:
1. Update both backend and frontend types
2. Keep schemas in sync with types
3. Add/update tests
4. Document changes in this README
5. Update API documentation if endpoints change

## License

Part of AgenticPay project. See main LICENSE file.
