# Webhook Signature Verification with Key Rotation

Two cooperating modules implement inbound webhook signature verification backed by a
versioned, rotating key registry:

- `src/services/webhookKeys.ts` — the key registry: lifecycle, rotation, revocation,
  retention, signing and constant-time verification with metrics.
- `src/middleware/webhookVerification.ts` — Express middleware that verifies inbound
  `custom` webhooks against the registry (rotation-aware), falling back to the legacy
  per-provider secrets when no keys are registered.

## Signature scheme

Messages are covered by an HMAC-SHA256 digest over `"<seconds>.<rawBody>"` (the same
message format used by `services/webhooks/signer.ts`):

```
digest = HMAC-SHA256(secret, `${timestampSeconds}.${rawBody}`)
```

Accepted signature header values (normalized before comparison):

| Form                          | Example                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| bare v1                       | `v1=a1b2…` (64 hex chars)                                      |
| v1 + embedded keyId           | `v1=wvk_custom_m8p0_9f2c.a1b2…`                               |
| legacy prefix                 | `sha256=a1b2…` / `sig-sha256=a1b2…` / `sha256-a1b2…`            |
| bare hex (no prefix)          | `a1b2…`                                                         |

Embedding the `keyId` in the signature string keeps verification unambiguous across
rotations even when the caller does not send a separate `keyId` header.

## Key lifecycle

```
register ──> active
                 │ rotate()
                 ├── retiredAt = now
                 ├── expiresAt = now + overlap (still VERIFIES during overlap)
                 v
              retiring ▸ expire ▸ purge after retention
                 ▲
                 │ revoke(keyId)
                 └── revoked (fails immediately, purged after retention)
```

- **Exactly one active key per provider** is created by `rotate()`. Previous active keys
  become `retiring` and remain valid for verification for `overlapSeconds` (default 72 h)
  so inflight deliveries signed with the old key are not rejected.
- `revoke(keyId)` immediately invalidates a key (emergency). `revoke` refuses the last
  active key for a provider — rotate first.
- `purgeExpired()` removes retired/revoked keys past `retentionSeconds` (default 7 d) and
  fully-expired active keys; it runs as part of `rotate()` to bound memory growth.
- Keys are per-provider; an optional `~expiresAt` may be set on any key.

## `services/webhookKeys.ts` API

```ts
const registry = getWebhookKeyRegistry();          // shared singleton

registry.register({ provider: 'custom', secret }); // or let it generate a secret
const { retired, active } = registry.rotate({ provider: 'custom' });
registry.revoke(keyId);

const signed = registry.sign({ provider: 'custom', body: rawBody });
// { signature: 'v1=wvk_custom_….hex', timestamp: '1700000000', keyId, version: 'v1' }

const result = registry.verify({
  signature, timestamp, body: rawBody, provider: 'custom',
});
// { isValid, keyId?, timestamp, ageMs, error?, reason? }
```

`reason` on a failed verification is one of: `missing_signature`,
`invalid_signature_format`, `missing_timestamp`, `timestamp_out_of_tolerance`,
`no_keys`, `unknown_key`, `key_revoked`, `key_expired`, `signature_mismatch`.

- Timestamps may be seconds, milliseconds, or ISO 8601 strings.
- The replay window defaults to 300 s (set via `toleranceSeconds` on the registry or
  `configureWebhookVerification({ toleranceSeconds })`).
- Overlap/retention/tolerance are configurable per instance
  (`new WebhookKeyRegistry({ now, overlapSeconds, retentionSeconds, toleranceSeconds, keys })`);
  `now` is injectable for deterministic rotation tests.
- `sign()` refuses non-active keys (`WEBHOOK_KEY_NOT_ACTIVE`) and unregistered keyIds.
- Metrics via `registry.metrics()`: counts of register/rotate/revoke/purge/sign/verify,
  plus per-reason rejection counters. `resetMetrics()` resets counters only.

## Middleware integration

`verifyCustomProviderWebhook` (`webhookVerifiers.custom`) now routes through
`verifyCustomProviderWebhookWithKeys`:

1. Registry keys exist + a signature and timestamp header are present → verify against the
   registry (rotation-aware, keyId-aware).
2. Otherwise → legacy `verifyWebhookSignature` path (single-secret map in
   `services/webhooks/verification.ts`), preserving existing behavior when the registry is
   not configured.

Signature/timestamp headers are read from either convention:

| Role      | AgenticPay outbound                    | Third-party custom                  |
| --------- | -------------------------------------- | ----------------------------------- |
| signature | `X-AgenticPay-Signature`               | `X-Signature`                       |
| timestamp | `X-AgenticPay-Timestamp`               | `X-Timestamp`                       |
| keyId     | `X-Webhook-Key-Id` (optional)          | `X-Webhook-Key-Id` (optional)       |

Failure surfaces as `401 WEBHOOK_VERIFICATION_FAILED`; duplicate event deliveries surface
as `409 WEBHOOK_REPLAY` (event ID from `X-Webhook-Id`).

Configuration:

```ts
import { configureWebhookVerification, resetWebhookVerificationConfig } from '../middleware/index.js';

configureWebhookVerification({ useKeyRotation: true, toleranceSeconds: 300 });
```

`middleware/index.ts` re-exports the real names (`verifyWebhookProvider`,
`webhookVerifiers`, `captureRawBody`, `webhookJsonParser`, `configureWebhookVerification`,
and `WebhookVerificationConfig`).

## Rotating a key at runtime

```ts
const registry = getWebhookKeyRegistry();
const { active } = registry.rotate({ provider: 'custom', secret: 'new_32+_char_secret' });

// Share the new secret with the sender. Old signatures keep working until the
// 72 h overlap elapses; then rotate again or revoke the prior key.
```

## Security notes

- Comparison uses `timingSafeEqual` on decoded digests (constant time).
- `parseWebhookSignature` rejects malformed/hostile header values before hashing.
- Timestamp tolerance prevents replay within 300 s; `isReplayEvent` in the middleware
  dedupes event IDs (5 min TTL) — swap the in-memory dedupe for Redis in multi-instance
  deploys.
- `sign()` never signs with retiring/revoked keys, so a rotated key cannot be resurrected
  through an intermediary.
- Secrets are generated with `crypto.randomBytes(32)` (base64url) when not supplied.
- The registry is intentionally dependency-free (no errorHandler/logger), so it can be
  loaded in any context including tests.

## Testing

```bash
npx vitest run src/services/__tests__/webhookKeys.test.ts                # registry + rotation (41)
npx vitest run src/middleware/__tests__/webhookVerification.test.ts      # middleware paths (8)
npx vitest run src/middleware/__tests__/webhookVerification.integration.test.ts  # real HTTP (7)
npx vitest run src/middleware/__tests__/webhookVerification.dispatcher.test.ts  # dispatcher paths (7)
```

Coverage (v8, scoped to `webhookKeys.ts` + `webhookVerification.ts` via
`--coverage.include`): statements 95.4%, branches 87.9%, functions 95.8%, lines 96.3%
(all ≥80% threshold).

## Performance

Endpoints added to the benchmark harness:

| Endpoint                     | Method | Notes                                        |
| ---------------------------- | ------ | -------------------------------------------- |
| `/api/v1/webhook/verify`       | POST | Valid HMAC signature → 200                   |
| `/api/v1/webhook/verify-invalid` | POST | Constant-time rejection path → 401           |

`npm run benchmark:baseline` regenerates `benchmarks/baseline.json`. Results on this host:

| Endpoint | ~RPS  | p99  | Errors |
| --- | --- | --- | --- |
| valid   | ~1.7k | 14 ms | 0 |
| invalid | ~1.6k | 13 ms | 0 (401s expected) |

`npm run benchmark:compare` fails CI only if p99 regresses beyond the configured ratio.