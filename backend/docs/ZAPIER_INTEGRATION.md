# Zapier Webhook Integration Guide

## Overview

AgenticPay's Zapier integration enables no-code and low-code workflows connecting Stellar & fiat payment events to 6,000+ apps in Zapier (e.g. Google Sheets, Slack, Salesforce, QuickBooks, HubSpot, Zendesk, Discord, Notion).

The integration provides:
1. **Event-driven Triggers (REST Hooks)**: Instant webhooks dispatched to Zapier when payments, invoices, disputes, or refunds change state.
2. **Zapier Actions (Inbound Operations)**: Execute AgenticPay operations from any Zap (create invoice, create payment link, issue refund, verify payment).
3. **Notification Channel**: Native `ZapierChannel` for the multi-channel notification subsystem.
4. **Signature Verification**: HMAC-SHA256 request signing with replay protection and timestamps.
5. **Sample Payloads**: Built-in test schema generator for Zapier's visual field mapping.

---

## Architecture

```
+-------------------------------------------------------------------+
|                        Zapier Platform                            |
+-------------------+---------------------------+-------------------+
                    | (1) Subscribe Hook        ^ (3) Trigger Webhook
                    |     (POST /hooks/subscribe)   (HMAC-SHA256 Signed)
                    v                           |
+-------------------------------------------------------------------+
|                        AgenticPay API                             |
|                                                                   |
|   /api/v1/zapier/hooks/subscribe   <-- Registers REST Hook URL    |
|   /api/v1/zapier/hooks/unsubscribe <-- Removes REST Hook URL      |
|   /api/v1/zapier/triggers/:event/sample <-- Zap Field Mapping     |
|   /api/v1/zapier/actions/*         <-- Inbound Zapier Actions     |
|   /api/v1/zapier/webhooks          <-- Catch Custom Webhooks      |
|                                                                   |
|   +-----------------------------------------------------------+   |
|   | ZapierWebhookService + ZapierClient                       |   |
|   | - HMAC Signature Generator (X-Zapier-Signature)           |   |
|   | - Exponential Backoff & Retry Logic                       |   |
|   | - Delivery Latency & Status Tracking                      |   |
|   +-----------------------------------------------------------+   |
+-------------------------------------------------------------------+
```

---

## Supported Zapier Triggers

| Event Key | Trigger Name | Description |
|-----------|--------------|-------------|
| `payment.succeeded` | Payment Succeeded | Stellar or fiat transaction settled |
| `payment.failed` | Payment Failed | Payment attempt failed or rejected |
| `invoice.created` | Invoice Created | New invoice issued |
| `invoice.paid` | Invoice Paid | Invoice marked settled |
| `dispute.opened` | Dispute Opened | Chargeback or dispute initiated |
| `dispute.resolved` | Dispute Resolved | Dispute closed (won/lost) |
| `refund.created` | Refund Created | Refund initiated |
| `refund.completed` | Refund Completed | Refund successfully completed |
| `webhook.test` | Connection Ping | Test connectivity from Zapier editor |

### Fetching Sample Data for Field Mapping
Zapier uses sample data during Zap setup so users can map fields into downstream apps:

```http
GET /api/v1/zapier/triggers/payment.succeeded/sample
```

Response:
```json
[
  {
    "id": "pay_sample_98439201",
    "status": "succeeded",
    "amount": 150.0,
    "currency": "USD",
    "merchantId": "merch_01h8q2",
    "customer": {
      "id": "cus_99321",
      "email": "jane.doe@example.com",
      "name": "Jane Doe"
    },
    "paymentMethod": "stellar_usdc",
    "stellarTxHash": "9d4fae09c85112e3e56a4225be69c4b14d2325c88b7f8df20b419b4564c7ad01",
    "fee": 0.15,
    "netAmount": 149.85,
    "createdAt": "2026-09-24T12:00:00.000Z",
    "description": "Software subscription license renewal"
  }
]
```

---

## REST Hook Subscription Lifecycle

### 1. Subscribe (Zap Turned On)
When a user activates a Zap, Zapier calls:

```http
POST /api/v1/zapier/hooks/subscribe
Content-Type: application/json

{
  "hookUrl": "https://hooks.zapier.com/hooks/catch/12345/abcdef",
  "event": "payment.succeeded",
  "merchantId": "merch_001",
  "secret": "optional-shared-secret-for-hmac"
}
```

Response (HTTP 201):
```json
{
  "id": "zap_sub_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "hookUrl": "https://hooks.zapier.com/hooks/catch/12345/abcdef",
  "event": "payment.succeeded",
  "status": "active",
  "createdAt": "2026-09-24T12:05:00.000Z"
}
```

### 2. Unsubscribe (Zap Turned Off or Deleted)
When a Zap is turned off:

```http
DELETE /api/v1/zapier/hooks/unsubscribe/zap_sub_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d
```

Or via POST body:
```http
POST /api/v1/zapier/hooks/unsubscribe
Content-Type: application/json

{
  "hookUrl": "https://hooks.zapier.com/hooks/catch/12345/abcdef"
}
```

---

## Outbound Webhook Delivery & Security

Outgoing webhooks sent from AgenticPay to Zapier include headers:
- `X-Zapier-Event-Id`: Unique event ID (`zap_evt_*`) for deduplication.
- `X-Zapier-Timestamp`: Unix timestamp (seconds) for replay prevention.
- `X-Zapier-Event-Type`: Name of trigger event (e.g. `payment.succeeded`).
- `X-Zapier-Signature`: HMAC-SHA256 signature when secret is configured:
  ```
  signature = "sha256=" + HMAC_SHA256(secret, timestamp + "." + jsonPayload)
  ```

---

## Supported Zapier Actions

Zaps can perform actions inside AgenticPay:

### 1. Create Invoice
```http
POST /api/v1/zapier/actions/invoice
Content-Type: application/json

{
  "customerName": "Jane Doe",
  "customerEmail": "jane@example.com",
  "amount": 250.00,
  "currency": "USD",
  "description": "Consulting Services (via Zapier)",
  "dueDate": "2026-10-15T00:00:00Z"
}
```

### 2. Create Payment Link
```http
POST /api/v1/zapier/actions/payment-link
Content-Type: application/json

{
  "title": "VIP Ticket",
  "amount": 100.00,
  "currency": "USD",
  "description": "Event Admission"
}
```

### 3. Issue Refund
```http
POST /api/v1/zapier/actions/refund
Content-Type: application/json

{
  "paymentId": "pay_98439201",
  "amount": 150.00,
  "reason": "Customer cancellation via Zendesk"
}
```

### 4. Verify Payment
```http
POST /api/v1/zapier/actions/verify
Content-Type: application/json

{
  "paymentId": "pay_98439201"
}
```

---

## Inbound Webhook Catch Endpoint

Zapier Webhooks action can post directly to AgenticPay:

```http
POST /api/v1/zapier/webhooks
Content-Type: application/json
X-Zapier-Signature: sha256=... (optional)
X-Zapier-Timestamp: 1700000000 (optional)

{
  "event": "lead_converted",
  "leadId": "lead_123"
}
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `ZAPIER_WEBHOOK_URL` | Outbound Zapier Catch Hook URL for notifications |
| `ZAPIER_WEBHOOK_SECRET` | Shared HMAC secret for signing Zapier webhooks |
