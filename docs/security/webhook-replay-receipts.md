# Webhook replay receipts

Every inbound webhook is recorded in the `webhook_receipts` table before its
handler runs, so a delivery is acted on at most once, across all API
instances (#1472).

Code: [`backend/src/services/webhookReplay.ts`](../../backend/src/services/webhookReplay.ts).
Migration: `backend/prisma/migrations/20261123000000_webhook_receipts`.

## Covered endpoints

| Endpoint | Receipt namespace | Event ID |
| --- | --- | --- |
| `POST /webhooks/stripe` | `stripe` | Stripe event ID (signed) |
| `POST /webhooks/paypal` | `paypal` | `X-Webhook-Id`, else `PayPal-Transmission-Id` |
| `POST /webhooks/github` | `github` | `X-GitHub-Delivery` |
| `POST /webhooks/custom` | `custom` | `X-Webhook-Id` |
| `POST /api/v1/fiat-payments/webhooks/bank-partner` | `bank-partner` | `X-Webhook-Id` |
| `POST /api/v1/stripe/webhooks` | `stripe-payments` | Stripe event ID (signed) |
| `POST /api/v1/razorpay/webhook` | `razorpay` | `X-Razorpay-Event-Id`, else a body hash |
| `POST /api/v1/instamojo/webhook` | `instamojo` | `payment_id:status` |
| `POST /api/v1/integrations/woocommerce/webhooks` | `woocommerce` | `X-WC-Webhook-Delivery-ID`, else the signature |

Receipts are created only after the signature check passes; badly signed
requests never create one. Razorpay and Instamojo skip their signature check
when `RAZORPAY_WEBHOOK_SECRET` / `INSTAMOJO_PRIVATE_SALT` is not set, and their
deliveries are then deduplicated, but not authenticated. Set those secrets in
production.

## Rules

- **One receipt per delivery, matched two ways.** A delivery is a duplicate if
  its provider already has a receipt with the same event ID *or* the same
  signature hash. Several providers send the event ID in an unsigned header,
  so matching on the signature catches a byte-for-byte replay even when an
  attacker changes or drops that header.
- **Final only after success.** The receipt becomes `processed` when the
  handler answers 2xx. Any other status, or a dropped connection, marks it
  `failed`, and the provider's next retry is processed. A claim left
  `processing` for more than 5 minutes (for example, the process crashed) can
  also be retried.
- **Replay window.** Receipts are kept for 7 days. Deliveries whose signed
  event time is older than 6 days are rejected, so pruning a receipt never
  re-opens its event. (GitHub signs no timestamp, so this check does not apply
  to it.)
- **Fail closed.** If the receipt cannot be written, the delivery is answered
  `503` and the handler does not run; the provider retries later.
- Only hashes of the body and signature are stored, never the payload.

## Responses

| Status | Code | When |
| --- | --- | --- |
| 409 | `WEBHOOK_REPLAY` | Already processed, or another instance is processing it |
| 409 | `WEBHOOK_EVENT_CONFLICT` | Same event ID with a different body (tampering or a provider bug; logged as an error) |
| 400 | `WEBHOOK_EVENT_STALE` | Signed event time is outside the replay window |
| 503 | `WEBHOOK_RECEIPT_UNAVAILABLE` | Receipt store unreachable |

Accepted deliveries carry `X-Webhook-Receipt: accepted` (or `retry` for a
reclaimed failed delivery).

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `WEBHOOK_RECEIPT_STORE` | `database` in production, `memory` elsewhere | `database` uses the `webhook_receipts` table and is required with more than one instance. |

Run `npm run db:migrate` before deploying. Without the table, every webhook is
answered `503` and retried by the provider.

## Observability

- Logs (`module: webhook-receipts`): `Webhook replay detected` (with
  `matchedOn: event_id | signature`), `Webhook event ID reused with a
  different payload`, `Stale webhook delivery rejected`,
  `Webhook retry reclaimed receipt`.
- `getWebhookReplayGuard().stats()` returns per-provider counts of
  `accepted`, `duplicate`, `conflict`, `stale`, `reclaimed`, `processed` and
  `failed`.
- Expired receipts are pruned at most once an hour, as deliveries arrive.
