# @agenticpay/sdk-core

Shared Stellar SDK wrappers and primitives for the AgenticPay platform, extracted under Issue #1398.

## Purpose

`@agenticpay/sdk-core` provides pure, shared utilities for interacting with the Stellar and Soroban networks. It is consumed by both the backend service layer (`backend/src/services/stellar.ts`) and the client SDK (`packages/sdk`).

## Architecture & Dependency Direction

```
        ┌──────────────────┐
        │  @stellar/       │
        │  stellar-sdk     │
        └────────▲─────────┘
                 │
        ┌────────┴─────────┐
        │ @agenticpay/     │
        │ sdk-core         │
        └───▲───────────▲──┘
            │           │
┌───────────┴──┐     ┌──┴────────────┐
│ backend/     │     │ packages/sdk  │
└──────────────┘     └───────────────┘
```

- **Zero network calls at import time**: Initializing clients or importing modules does not perform external HTTP requests.
- **Pure extraction**: Existing transaction building, network configuration, address validation, and manifest verification logic is centralized here.

## Modules

- `network`: Passphrase resolution, Horizon URLs, RPC URLs, server constructors.
- `address`: Address, contract ID, and transaction hash validators and assertion helpers.
- `account`: Account loading and balance extraction.
- `transaction`: Base fee calculations, fee bump multipliers, stuck transaction heuristics, and Horizon error translation.
- `contract`: WASM SHA-256 byte hashing and Soroban build manifest parsing.

## Usage

```typescript
import {
  isValidStellarAddress,
  getHorizonUrl,
  createHorizonServer,
  estimateFee,
} from '@agenticpay/sdk-core';

if (isValidStellarAddress('G...')) {
  const server = createHorizonServer('testnet');
  const fee = estimateFee(100, 2);
}
```
