# Developer platform tools

## Idempotent SDK retries

The TypeScript SDK automatically adds an `Idempotency-Key` header to `POST`, `PATCH`, and
`DELETE` requests. The same key is retained for every built-in retry. Callers can provide their
own `Idempotency-Key` (or `X-Idempotency-Key`) header when a key must survive across processes.

For custom transports, use the retry helper directly:

```ts
import { withIdempotencyRetry } from '@agenticpay/sdk';

const payment = await withIdempotencyRetry(
  ({ idempotencyKey }) =>
    customTransport.createPayment(payload, {
      'Idempotency-Key': idempotencyKey,
    }),
  { maxRetries: 2, shouldRetry: (error) => isTemporary(error) }
);
```

`createIdempotencyKey()` is also exported for callers that only need key generation.

## Correlated request logs

Every backend request has an `X-Request-Id` and `X-Trace-Id`. Send either header to retain an
existing identifier; otherwise the server generates one and returns it in the response. Both
identifiers are included in structured HTTP logs and remain available across asynchronous work.
Authorization, cookies, API keys, and webhook signatures are redacted from request logs.

## Marketplace directory

`GET /api/v1/plugins/marketplace` lists the built-in app integrations and their install source,
version, category, publisher, tags, and AgenticPay compatibility. It supports these optional query
parameters:

- `q`: case-insensitive text search across names, descriptions, publishers, and tags
- `category`: exact category filter

The response includes the result count and available categories in `meta`.

## Local webhook receiver

In development and test environments, send sample webhook traffic to:

```text
POST   /api/dev/webhooks
GET    /api/dev/webhooks/deliveries
DELETE /api/dev/webhooks/deliveries
```

The receiver keeps the latest 100 deliveries in memory and returns `202 Accepted` when a payload
is captured. Authorization, cookie, and API-key headers are redacted. Deliveries disappear when
the backend restarts. The route is not mounted in production.
