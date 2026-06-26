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
