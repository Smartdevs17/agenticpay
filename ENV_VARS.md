# Environment Variables

## Backend

| Variable             | Description                         | Default | Required |
| -------------------- | ----------------------------------- | ------- | -------- |
| PORT                 | Server port                         | 3001    | No       |
| CORS_ALLOWED_ORIGINS | Allowed origins for CORS            | \*      | No       |
| JOBS_ENABLED         | Enable/disable background jobs      | true    | No       |
| STELLAR_NETWORK      | Stellar network (testnet or public) | testnet | No       |
| OPENAI_API_KEY       | OpenAI API key for AI services      | -       | **Yes**  |
| AGENTICPAY_ALLOWED_SIGNATURE_ORIGINS | Allowed origins for EIP-712 signature verification | https://agenticpay.com,http://localhost:3000 | No |
| VAPID_PUBLIC_KEY     | VAPID public key for Web Push API   | auto-generated | No       |
| VAPID_PRIVATE_KEY    | VAPID private key for Web Push API  | auto-generated | No       |
| WS_ENABLED           | Enable/disable WebSocket support    | true    | No       |
| WS_PORT              | WebSocket port                      | 3001    | No       |
| PAYOUT_APPROVAL_THRESHOLD | Payouts at or above this amount require approval | 10000 | No |
| JWT_SECRET | HS256 signing secret for access tokens (min 32 chars). Required in production; dev/test fall back to a per-process random secret | - | Prod |
| JWT_SECRET_PREVIOUS | Previous signing secret, still accepted for verification during key rotation | - | No |
| JWT_ACCESS_TOKEN_TTL_SECONDS | Access token lifetime, clamped to 60–3600 | 900 | No |
| JWT_ISSUER / JWT_AUDIENCE | Expected `iss` / `aud` claims | agenticpay / agenticpay-api | No |
| PAYOUT_ANOMALY_DETECTION_ENABLED | Set to `false` to stop raising payout anomaly flags | true | No |
| PAYOUT_ANOMALY_SINGLE_THRESHOLD | A single payout at or above this amount is flagged | 50000 | No |
| PAYOUT_ANOMALY_VELOCITY_WINDOW_MS | Window for payout velocity rules | 3600000 | No |
| PAYOUT_ANOMALY_VELOCITY_MAX_COUNT | Payouts per merchant per window before flagging | 20 | No |
| PAYOUT_ANOMALY_VELOCITY_MAX_AMOUNT | Payout volume per merchant per window before flagging | 100000 | No |
| PAYOUT_ANOMALY_BASELINE_MULTIPLIER | Flag payouts this many times the merchant's rolling average | 5 | No |
| PAYOUT_ANOMALY_BASELINE_MIN_SAMPLES | Payouts needed before the baseline rule applies | 5 | No |
| PAYOUT_ANOMALY_BASELINE_SAMPLE_SIZE | Payouts kept per merchant for the rolling baseline | 50 | No |
| PAYOUT_BATCH_MAX_SIZE | Maximum payouts sent in one provider call | 100 | No |
| PAYOUT_PROVIDER_FEE_PER_CALL | Flat provider fee per call, used for the fees-saved estimate in batch reports | 0 | No |

## Frontend

| Variable                | Description          | Default                      |
| ----------------------- | -------------------- | ---------------------------- |
| NEXT_PUBLIC_API_URL     | Backend API base URL | http://localhost:3001/api/v1 |
| NEXT_PUBLIC_BACKEND_URL | Backend URL fallback | http://localhost:3001/api/v1 |
| NEXT_PUBLIC_WS_URL      | WebSocket URL        | http://localhost:3001        |
| NEXT_PUBLIC_WS_ENABLED  | Enable WebSocket     | true                         |

## Environment Files

- `.env.example`
```
PORT=3001
CORS_ALLOWED_ORIGINS=http://localhost:3000
JOBS_ENABLED=true
STELLAR_NETWORK=testnet
OPENAI_API_KEY=sk-your-openai-api-key
AGENTICPAY_ALLOWED_SIGNATURE_ORIGINS=https://agenticpay.com,http://localhost:3000
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
WS_ENABLED=true
```

- `.env.development` — local development
- `.env.staging` — staging environment
- `.env.production` — production environment

## Push Notification Setup

### Generating VAPID Keys

To generate VAPID keys for push notifications:

```bash
cd backend
npm run generate:vapid-keys
```

This will output both public and private keys. Add them to your `.env` file:

```
VAPID_PUBLIC_KEY=<key_from_output>
VAPID_PRIVATE_KEY=<key_from_output>
```

**Important**: Keep your VAPID private key secret and never commit it to version control.

See [PUSH_NOTIFICATIONS.md](./docs/PUSH_NOTIFICATIONS.md) for complete push notification setup guide.

## Notes

- Never commit `.env` files containing real secrets to version control
- Copy the appropriate file and rename to `.env` when running locally
- VAPID keys are required for push notification functionality
- WebSocket support is required for real-time notifications
