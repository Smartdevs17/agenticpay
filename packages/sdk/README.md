# @agenticpay/sdk

Official TypeScript SDK for AgenticPay APIs.

## Install

```bash
npm install @agenticpay/sdk
```

## Usage

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

## Features

- Strict TypeScript types
- API error hierarchy
- Auth helpers and interceptors
- Retry/backoff support
- Verification, split payments, and refunds APIs
