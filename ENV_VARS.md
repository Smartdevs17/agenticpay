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
