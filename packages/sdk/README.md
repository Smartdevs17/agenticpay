# @agenticpay/sdk

Official TypeScript SDK for AgenticPay APIs.

## Install

```bash
npm install @agenticpay/sdk
```

## Getting started

```ts
import { createAgenticPaySDK } from '@agenticpay/sdk';

const sdk = createAgenticPaySDK({
  baseUrl: 'https://api.agenticpay.com/api/v1',
  apiKey: process.env.AGENTICPAY_API_KEY,
});

const split = await sdk.payments.createSplitConfig({
  merchantId: 'm_123',
  platformFeePercentage: 2.5,
  recipients: [
    { recipientId: 'r1', walletAddress: '0xabc', percentage: 60, minimumThreshold: 1 },
    { recipientId: 'r2', walletAddress: '0xdef', percentage: 37.5, minimumThreshold: 1 },
  ],
});
```

## Runnable examples

```bash
cd packages/sdk
export AGENTICPAY_API_KEY=your_key
npm run example:getting-started
npm run example:split
npm run example:errors
```

## Documentation

| Topic | Location |
|-------|----------|
| API reference (TypeDoc) | `npm run docs` → `docs/api/` |
| REST → SDK migration | [`docs/sdk/MIGRATION-FROM-REST.md`](../../docs/sdk/MIGRATION-FROM-REST.md) |
| Error handling | [`docs/sdk/ERROR-HANDLING.md`](../../docs/sdk/ERROR-HANDLING.md) |
| Changelog | [CHANGELOG.md](./CHANGELOG.md) |

## Features

- Strict TypeScript types (see [`@agenticpay/types`](../types/README.md))
- API error hierarchy with `code` and `details`
- Auth helpers and interceptors
- Retry/backoff support
- Verification, split payments, and refunds APIs

## OpenAPI client

For full OpenAPI coverage immediately after spec changes, use the generated client under `backend/docs/api/sdks/typescript/`. This package offers curated, stable ergonomics for common flows.
