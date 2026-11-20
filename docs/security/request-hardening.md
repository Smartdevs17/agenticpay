# Request and data hardening

This page covers four controls shipped together:

| Issue | Control | Code |
| ----- | ------- | ---- |
| #1488 | Strict schema validation at every REST boundary | `backend/src/middleware/validate.ts` |
| #1486 | Fresh signature for high-value withdrawals | `backend/src/middleware/requireFreshSignature.ts`, `backend/src/routes/withdrawals.ts` |
| #1492 | Tenant-scoped PII redaction in logs | `backend/src/utils/logger.ts`, `backend/src/logging/redact.ts` |
| #1494 | Signed, time-bounded receipt downloads with per-user audit | `backend/src/services/receipts.ts`, `backend/src/routes/receipts.ts` |

## 1. Strict request validation (#1488)

`validateRequest` and `validate` apply these rules to `body`, `query` and `params`:

- **Unknown keys are rejected.** Object schemas are made `.strict()`. Each unknown key is reported as its own field path, for example `isAdmin`, with the message `Unrecognized field`.
- **Prototype-polluting keys are rejected at any depth.** `__proto__`, `constructor` and `prototype` return a 400 with the message `Forbidden key`, before schema parsing runs.
- **Error responses are generic.** The body is `{ error: 'VALIDATION_FAILED', message: 'Request validation failed', details: [{ path, message }] }`. Submitted values are never echoed.
- **Failures are logged without values.** Each failure writes a `request.validation_failed` warning with the target (`body`, `query` or `params`) and the field paths.

**Client impact:** requests that send fields the schema does not declare now get a 400. Clients that send extra fields must remove them.

## 2. Fresh signature for high-value withdrawals (#1486)

A withdrawal whose amount is at or above `HIGH_VALUE_WITHDRAWAL_THRESHOLD` (default `10000`) must carry a signature made by the requester at request time. The gate applies to:

- `POST /api/v1/withdrawals/:walletId/requests`, using `requestedBy` as the signer and `amount` as the value
- `POST /api/v1/withdrawals/requests/:requestId/execute`, using the stored request's `requestedBy` and `amount`

### Headers

| Header | Value |
| ------ | ----- |
| `X-Fresh-Signature` | Hex HMAC-SHA256 of the canonical payload |
| `X-Fresh-Timestamp` | Request time in Unix milliseconds |
| `X-Fresh-Nonce` | 16–128 characters from `[A-Za-z0-9_-]`, unique per request |

All three are required together.

### Canonical payload

```
FRESH-V1
<METHOD>
<full path without query string, e.g. /api/v1/withdrawals/wallet-1/requests>
<timestamp>
<nonce>
<sha256 hex of JSON.stringify(body)>
```

The HMAC key is the requester's registered secret (at least 32 characters). Register keys with `registerFreshSignatureKey(principalId, secret)`.

### Rules

- The timestamp must be within 2 minutes in the past, and at most 30 seconds in the future.
- Each nonce is accepted once. A reused nonce returns `409 FRESH_SIGNATURE_REPLAYED`.
- A requester with no registered key is refused (`401 FRESH_SIGNATURE_UNKNOWN_SIGNER`). The gate fails closed.
- A non-numeric `amount` is treated as high-value, so it cannot skip the gate.

### Error codes

| HTTP | Code | Meaning |
| ---- | ---- | ------- |
| 401 | `FRESH_SIGNATURE_REQUIRED` | High-value request with no signature headers |
| 401 | `FRESH_SIGNATURE_INCOMPLETE` | Only some of the three headers were sent |
| 401 | `FRESH_SIGNATURE_UNKNOWN_SIGNER` | No key registered for the requester |
| 401 | `FRESH_SIGNATURE_EXPIRED` | Timestamp outside the allowed window |
| 401 | `FRESH_SIGNATURE_INVALID` | Malformed header, or signature does not match |
| 409 | `FRESH_SIGNATURE_REPLAYED` | Nonce already used |

**Limitation:** the key registry and nonce store are in-memory and per process. A multi-instance deployment needs a shared key store and a shared nonce store before this gate is relied on in production. The nonce check is the piece most affected by running several instances.

## 3. Tenant-scoped PII redaction (#1492)

Every log argument is redacted before it reaches the console. The pino request logger (`middleware/logger.ts`) uses the same function.

1. **Base rules always apply** to every tenant and cannot be turned off: secret-named keys (`password`, `secret`, `token`, `apiKey`, …), email addresses, Stripe-style keys, webhook secrets, Bearer tokens, and card numbers.
2. **Tenant policy adds rules.** When the request is authenticated, `auth.ts` puts the tenant ID on the log context. If that tenant has a policy, its extra keys and patterns are also redacted.

```ts
import { setTenantRedactionPolicy } from '../utils/logger.js';

setTenantRedactionPolicy('tenant-123', {
  sensitiveKeys: ['taxId', 'bankAccount'],
  patterns: [{ name: 'IBAN', pattern: /\bGB\d{2}[A-Z0-9]{14,18}\b/ }],
});
```

- Policies only add redactions. A policy cannot remove a base rule.
- Key names are matched case-insensitively.
- Pattern names must be `UPPER_SNAKE_CASE`.
- If redaction fails, for example on a cyclic object, the argument is replaced with `[REDACTION_FAILED]`. Logs fail closed.

**Fix included:** the card-number rule now requires a Luhn-valid number. Previously any 13–19 digit run was redacted, which hid 13-digit epoch-millisecond timestamps.

## 4. Signed receipt downloads with per-user audit (#1494)

Receipt PDFs are no longer downloadable by plain URL.

### Issue a link

`POST /api/v1/receipts/:tokenId/download-url` requires an authenticated caller and returns:

```json
{
  "url": "/api/v1/receipts/RCPT-00000001/pdf?uid=<userId>&iat=<ms>&expires=<ms>&sig=<hex>",
  "expiresAt": "2026-11-20T12:05:00.000Z"
}
```

Body (optional): `{ "ttlSeconds": 300 }`. The default is 300 seconds and the maximum is 900. Any other key, or a non-numeric `ttlSeconds`, returns 400.

### Download

`GET /api/v1/receipts/:tokenId/pdf?uid=…&iat=…&expires=…&sig=…` returns the PDF. The grant is checked in this order:

1. Signature (HMAC over receipt ID, user, `iat` and `expires`), compared in constant time
2. Lifetime: `expires - iat` must be at most 15 minutes
3. `iat` must not be in the future (30-second skew allowed)
4. `expires` must not have passed
5. The receipt must exist

Responses are `Cache-Control: private, no-store`.

### Audit

Every issuance and every download attempt is written to the audit log (`auditService`), including failures:

| Action | Outcome | `userId` | Details |
| ------ | ------- | -------- | ------- |
| `receipt.download_url_issued` | `success` | caller | |
| `receipt.download` | `success` | user in the grant | |
| `receipt.download` | `failure` | user in the URL, if any | `reason` = error code |

A link can be used by anyone who holds it until it expires, so keep the lifetime short. Each download is still attributed to the user the link was issued to.

### Configuration

| Variable | Purpose |
| -------- | ------- |
| `RECEIPT_DOWNLOAD_SECRET` | HMAC key for grants, at least 32 characters. Required in production. Other environments use a per-process secret, so links stop working after a restart. |

**Breaking change:** `GET /api/v1/receipts/:tokenId/pdf` without a valid grant now returns 401. No code in this repository called the endpoint directly. External callers must first call `download-url`.

## Rollout notes

- Set `RECEIPT_DOWNLOAD_SECRET` in every environment before deploying.
- Set `HIGH_VALUE_WITHDRAWAL_THRESHOLD` if the default 10000 does not suit the wallet's risk limits.
- Clients that send extra body fields will start getting 400s (see section 1).
- Clients creating high-value withdrawals need the signing flow from section 2.
