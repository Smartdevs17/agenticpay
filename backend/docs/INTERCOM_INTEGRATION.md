# Intercom Integration for Customer Support

The Intercom integration connects AgenticPay with Intercom's REST API (v2.10) to provide automated customer support, ticketing, conversation management, real-time escalation for payment failures, Help Center article search, and webhook synchronization.

---

## Architecture Overview

```
                      AgenticPay Platform
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Payment Failures /  ──────►  IntercomSupportService         │
│  Disputes / Errors            │                             │
│                               ▼                             │
│  Notification Events ──────►  IntercomChannel               │
│                               │                             │
│                               ▼                             │
│                        IntercomClient (v2.10)               │
│                               │                             │
└───────────────────────────────┼─────────────────────────────┘
                                │  HTTPS REST API
                                ▼
                        Intercom Platform
                     ┌─────────────────────┐
                     │ • Conversations     │
                     │ • Contacts          │
                     │ • Help Articles     │
                     │ • Webhook Events    │
                     └─────────────────────┘
```

---

## Features

1. **Support Tickets & Conversations**
   - Create support tickets associated with customers via `POST /api/v1/intercom/conversations`.
   - Automatically upserts contact profile (email, name, user tier, Stellar wallet).
   - High-priority and urgent tickets automatically post internal admin notes for prompt agent action.

2. **Conversation Lifecycle Management**
   - **Reply**: Post admin comments or private internal notes (`POST /api/v1/intercom/conversations/:id/reply`).
   - **Close**: Resolve and close conversations with optional closing notes (`POST /api/v1/intercom/conversations/:id/close`).
   - **Snooze**: Snooze conversations until a specific timestamp (`POST /api/v1/intercom/conversations/:id/snooze`).
   - **Tags**: Add/remove tags to categorize issues (`POST` / `DELETE /api/v1/intercom/conversations/:id/tags`).

3. **Autonomous Payment Failure Escalation**
   - Automatically escalates payment failures, transaction drops, or dispute events via `POST /api/v1/intercom/escalate`.
   - Packages payment ID, amount, currency, Stellar transaction hash, and invoice ID directly into the conversation.

4. **Help Center & Articles Search**
   - Query published knowledge base articles via `GET /api/v1/intercom/articles/search?query=stellar`.
   - Facilitates autonomous AI agents retrieving troubleshooting steps to resolve customer issues without human intervention.

5. **Notification Channel (`IntercomChannel`)**
   - Implements `NotificationChannel` interface.
   - Automatically registered in `channelRegistry` when `INTERCOM_ACCESS_TOKEN` is present.
   - Formats payment and system alerts into Intercom conversations.

6. **Inbound Webhook Verification**
   - Intercom webhooks received at `POST /api/v1/intercom/webhooks`.
   - Verified using HMAC-SHA1 (`x-hub-signature` header) with `INTERCOM_CLIENT_SECRET`.

---

## API Reference

### 1. Create Support Conversation

```http
POST /api/v1/intercom/conversations
Content-Type: application/json

{
  "userId": "usr_99812",
  "email": "customer@example.com",
  "name": "Jane Doe",
  "subject": "Payment verification delayed",
  "message": "My Stellar USDC payment did not settle within the expected 15-second window.",
  "category": "payment_failure",
  "priority": "high",
  "metadata": {
    "paymentId": "pay_54321",
    "invoiceId": "inv_12345"
  }
}
```

### 2. Auto-Escalate Payment Issue

```http
POST /api/v1/intercom/escalate
Content-Type: application/json

{
  "paymentId": "pay_98765",
  "userId": "usr_10203",
  "userEmail": "trader@example.com",
  "userName": "Alex Smith",
  "amount": 250.00,
  "currency": "USDC",
  "failureReason": "Stellar horizon submission timeout (tx_too_late)",
  "transactionHash": "4a7b9c...f8e2",
  "invoiceId": "inv_90812",
  "provider": "stellar"
}
```

### 3. Reply to Conversation

```http
POST /api/v1/intercom/conversations/:id/reply
Content-Type: application/json

{
  "body": "We have re-broadcast the Stellar transaction and confirmed settlement on ledger #48192841.",
  "messageType": "comment"
}
```

To leave an internal note visible only to support staff:
```http
POST /api/v1/intercom/conversations/:id/reply
Content-Type: application/json

{
  "body": "Customer's wallet has been credited manually; awaiting confirmation.",
  "messageType": "note"
}
```

### 4. Close Conversation

```http
POST /api/v1/intercom/conversations/:id/close
Content-Type: application/json

{
  "body": "Issue resolved. Closing conversation."
}
```

### 5. Search Knowledge Base Articles

```http
GET /api/v1/intercom/articles/search?query=refund&perPage=3
```

Response:
```json
{
  "query": "refund",
  "count": 2,
  "articles": [
    {
      "id": "art_101",
      "title": "How Stellar payment refunds work in AgenticPay",
      "body": "Refunds are processed back to the original Stellar account...",
      "url": "https://help.agenticpay.com/en/articles/101-stellar-refunds",
      "state": "published"
    }
  ]
}
```

### 6. Health Check

```http
GET /api/v1/intercom/health
```

Response:
```json
{
  "configured": true,
  "healthy": true,
  "message": "Intercom connection healthy"
}
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `INTERCOM_ACCESS_TOKEN` | Yes | Intercom API access token with permissions for contacts, conversations, and articles |
| `INTERCOM_APP_ID` | Optional | Intercom Workspace App ID |
| `INTERCOM_ADMIN_ID` | Optional | Default Admin ID for posting notes, replies, or assigning conversations |
| `INTERCOM_CLIENT_SECRET` | Optional | Secret key used to verify HMAC-SHA1 inbound webhooks (`x-hub-signature`) |
| `INTERCOM_API_URL` | Optional | Custom API endpoint (default: `https://api.intercom.io`) |
