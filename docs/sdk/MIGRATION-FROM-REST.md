# Migrating from REST to the SDK (#408)

## Install

```bash
npm install @agenticpay/sdk
```

## Base URL and auth

**REST**

```http
GET /api/v1/splits/configs?merchantId=m_123
Authorization: Bearer YOUR_API_KEY
```

**SDK**

```ts
import { createAgenticPaySDK } from '@agenticpay/sdk';

const sdk = createAgenticPaySDK({
  baseUrl: 'https://api.agenticpay.com/api/v1',
  apiKey: process.env.AGENTICPAY_API_KEY,
});
```

## Endpoint mapping

| REST | SDK |
|------|-----|
| `POST /verification/verify` | `sdk.verification.verify(...)` |
| `POST /splits/configs` | `sdk.payments.createSplitConfig(...)` |
| `GET /splits/configs/:id` | `sdk.payments.getSplitConfig(...)` |
| `POST /refunds` | `sdk.refunds.create(...)` |

## OpenAPI-generated client

The repo also ships an OpenAPI `openapi-fetch` client under `backend/docs/api/sdks/typescript/`. Prefer `@agenticpay/sdk` for curated ergonomics; use the generated client when you need every OpenAPI operation immediately after spec updates.

## Webhooks

Incoming provider webhooks stay HTTP endpoints (`POST /webhooks/stripe`). Outbound merchant webhooks are configured via the dashboard or `/api/v1/webhooks` — not the SDK.
