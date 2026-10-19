# Webhook Signatures

AgenticPay signs every outbound webhook with HMAC-SHA256 using the merchant webhook secret.

Headers:

- `X-AgenticPay-Signature`: versioned signature, for example `v1=<hex digest>`
- `X-AgenticPay-Timestamp`: Unix timestamp in seconds
- `X-AgenticPay-Signature-Version`: signature version
- `X-AgenticPay-Event-Id`: event id

The signed message is:

```text
timestamp + "." + raw_request_body
```

Reject webhooks when the timestamp is more than 5 minutes from local time.

```ts
import { verifyWebhookSignature } from '@agenticpay/sdk';

const valid = verifyWebhookSignature({
  payload: rawBody,
  signature: req.headers['x-agenticpay-signature'],
  timestamp: req.headers['x-agenticpay-timestamp'],
  secret: process.env.AGENTICPAY_WEBHOOK_SECRET!,
});
```

Webhook bodies also include `webhook.signature` for systems that cannot inspect headers. Prefer header verification when possible because it binds the raw request body.

## Inbound provider webhooks

Every inbound provider webhook is verified before its handler runs; a payload with a
missing, malformed or stale signature is rejected with `401`
`WEBHOOK_VERIFICATION_FAILED` and queued for audit.

| Source | Signature header | Timestamp header |
| ------ | ---------------- | ---------------- |
| Stripe (`POST /api/v1/stripe/webhooks`) | `Stripe-Signature` (Stripe SDK) | embedded in the signature |
| AgenticPay providers (`POST /webhooks/:provider`) | `X-Signature`, `X-Hub-Signature-256` (GitHub) | `X-Timestamp` / provider |
| Intercom | `X-Hub-Signature` (HMAC-SHA1) | n/a |
| Bank partner (`POST /api/v1/fiat-payments/webhooks/bank-partner`) | `X-Bank-Signature` | `X-Bank-Timestamp` |

- Signatures are HMAC-SHA256 over `${timestamp}.${rawBody}` and compared with
  `crypto.timingSafeEqual`; a non-hex or wrong-length signature fails closed.
- The **replay window** is enforced on every provider: a timestamp outside
  `toleranceSeconds` (default 300s) of server time is rejected, and a repeated
  `eventId` is rejected as a duplicate delivery.
- Provider fixtures used by the test suite live in
  [`backend/src/tests/fixtures/webhooks.ts`](../../backend/src/tests/fixtures/webhooks.ts).
  They cover valid, tampered, unsigned and stale payloads.

