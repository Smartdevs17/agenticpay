# Feature Flags — Gradual Rollout & Cohort A/B

Issue #1354 — `backend/src/services/featureFlags.ts` + `@agenticpay/sdk`.

## Gradual rollout

`upsertFlag` accepts `rolloutPercentage` (0–100) and optional `rolloutSchedule` for linear ramps between start/end percentages over time. Evaluation is deterministic per `(flag, identifier)` via MD5 bucketing.

## Cohort A/B testing

```ts
import { featureFlagEngine } from '../services/featureFlags.js';

featureFlagEngine.upsertCohort('new-checkout-flow', {
  id: 'beta',
  name: 'Beta testers',
  members: ['user-1'],       // explicit membership
  percentage: 10,            // or percentage bucket
  forceEnabled: true,
  variantKey: 'treatment',
});

featureFlagEngine.evaluateWithCohort('new-checkout-flow', 'user-1');
// { enabled: true, cohortId: 'beta', variant: 'treatment' }
```

## SDK

```ts
import { createAgenticPaySDK } from '@agenticpay/sdk';

const sdk = createAgenticPaySDK({ baseUrl, apiKey });
await sdk.featureFlags.evaluateWithCohort('new-checkout-flow', userId);
```

Pass `includeCohort=true` on `GET /api/v1/flags/evaluate` to merge cohort assignment into the response. Cohort metadata is only attached when the flag is registered in the gradual-rollout engine; the `enabled` value keeps coming from the canonical config flag store.
