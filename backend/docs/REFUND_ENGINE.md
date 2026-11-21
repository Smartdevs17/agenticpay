# Automated Refund Processing — Policy Engine Guide

## Overview

The AgenticPay Refund Engine provides fully automated refund processing with a customizable policy engine, multi-level approval workflows, queue-based background processing, real-time notifications via webhooks and notification channels, and comprehensive analytics.

## Architecture

```
Client → Refund API → Refund Engine → Policy Engine → Approval Workflow → Processing Queue → Provider
                            ↓                                                  ↓
                     Notification Service                              Audit Logger
                            ↓
              Webhooks / Push / Email / In-App
```

## Core Components

### 1. Refund Engine (`src/services/refund-engine.ts`)
The central service handling policy evaluation, approval workflow, processing, and analytics.

### 2. Refund Queue (`src/queue/refund-queue.ts`)
BullMQ-style background job processor that handles auto-processing and retries with configurable scheduling.

### 3. Refund Notifications (`src/services/refund-notifications.ts`)
Multi-channel notification dispatcher supporting webhooks, email, push, and in-app notifications.

### 4. Refund API (`src/routes/refunds-automated.ts`)
RESTful API mounted at `/api/v1/refunds-automated`.

---

## Features

### Automated Refund Processing
- Auto-approve refunds matching policy rules
- Background queue processing with configurable retry
- Synchronous and asynchronous processing modes
- Automatic retry for failed refunds (up to 3 attempts)

### Policy Engine
- Full refund window configuration (days since payment)
- Auto-approval thresholds (amount-based)
- Always-refund-under amount for small refunds
- Partial refund percentage limits
- Multi-level approval thresholds (first/second/third)
- **Custom Rules Engine**: Define rules with field, operator, value, and outcome combinations:

| Field | Operators | Example |
|-------|-----------|---------|
| `customer_tier` | eq, neq, in, not_in | `{field: "customer_tier", operator: "eq", value: "enterprise", outcome: "approve"}` |
| `payment_type` | eq, in | `{field: "payment_type", operator: "in", value: ["crypto"], outcome: "manual_review"}` |
| `previous_refund_count` | gt, gte, lt, lte | `{field: "previous_refund_count", operator: "gte", value: 3, outcome: "manual_review"}` |
| `customer_total_spent` | gt, gte | `{field: "customer_total_spent", operator: "gte", value: 10000, outcome: "approve"}` |
| `days_since_payment` | gt, gte, lt, lte | `{field: "days_since_payment", operator: "gt", value: 90, outcome: "reject"}` |
| `has_chargeback` | eq | `{field: "has_chargeback", operator: "eq", value: true, outcome: "manual_review"}` |
| `currency` | eq | `{field: "currency", operator: "eq", value: "USD", outcome: "approve"}` |

Rules are evaluated by priority (highest first). The first matching rule determines the outcome.

### Refund Status Tracking
Each refund has a full lifecycle with immutable history:

```
pending → approved → processing → completed
pending → rejected
pending → cancelled
approved → processing → failed → retry → approved → ...
```

### Refund Notifications
Notifications fired on every status transition:
- `refund.created`
- `refund.approved`
- `refund.rejected`
- `refund.processing`
- `refund.completed`
- `refund.failed`
- `refund.cancelled`
- `refund.pending_review`
- `refund.auto_processed`

### Webhook Subscriptions
Per-workspace webhook subscriptions with event filtering and optional secret headers.

### Refund Analytics
Comprehensive analytics including:
- Approval/rejection/manual review rates
- Auto-approval rate
- Average processing time
- SLA breach tracking
- Breakdowns by reason, status, payment type, customer tier
- Daily/weekly/monthly trends
- Date range filtering

---

## API Reference

All endpoints are under `/api/v1/refunds-automated`.

### Policy Management

| Method | Path | Description |
|--------|------|-------------|
| POST | `/policies` | Create/update a refund policy |
| GET | `/policies` | List policies for workspace |
| GET | `/policies/:name` | Get policy by name |
| DELETE | `/policies/:policyId` | Deactivate a policy |

### Refund Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/evaluate` | Evaluate a refund request against policy |
| POST | `/:refundId/approve` | Approve at a specific level |
| POST | `/:refundId/reject` | Reject at a specific level |
| POST | `/:refundId/process` | Queue for async processing |
| POST | `/:refundId/process-sync` | Process synchronously |
| POST | `/:refundId/cancel` | Cancel a pending refund |
| POST | `/:refundId/retry` | Retry a failed refund |

### Auto-Processing

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auto-process` | Queue auto-processing job |
| POST | `/auto-process-sync` | Auto-process immediately |

### Query

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List refunds with filters |
| GET | `/:refundId` | Get refund details |
| GET | `/:refundId/history` | Get refund status history |

### Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/analytics/:workspaceId` | Get refund analytics |
| GET | `/analytics/:workspaceId/summary` | Get global metrics summary |

### Queue Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/queue/jobs` | List queue jobs |
| GET | `/queue/jobs/:jobId` | Get job details |
| GET | `/queue/stats` | Get queue statistics |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhooks/subscribe` | Subscribe to refund webhooks |
| DELETE | `/webhooks/subscribe` | Unsubscribe a webhook |
| GET | `/webhooks/subscriptions` | List webhook subscriptions |

### Webhook Event Payload

```json
{
  "event": "refund.completed",
  "data": {
    "refundId": "uuid",
    "paymentId": "uuid",
    "amount": 100.00,
    "currency": "USD",
    "reason": "Customer requested refund",
    "status": "completed",
    "timestamp": "2026-07-30T12:00:00.000Z"
  },
  "timestamp": "2026-07-30T12:00:00.000Z"
}
```

### Webhook Headers
- `Content-Type: application/json`
- `X-Webhook-Signature`: Optional secret for verification

---

## Policy Configuration Example

```json
{
  "workspaceId": "ws-1",
  "name": "enterprise-policy",
  "fullRefundWindowDays": 60,
  "autoApprovalThreshold": 500,
  "alwaysRefundUnderAmount": 50,
  "maxPartialRefundPct": 80,
  "requireReason": true,
  "firstApprovalThreshold": 2000,
  "secondApprovalThreshold": 10000,
  "rules": [
    {
      "field": "customer_tier",
      "operator": "eq",
      "value": "enterprise",
      "outcome": "approve",
      "priority": 100
    },
    {
      "field": "previous_refund_count",
      "operator": "gte",
      "value": 5,
      "outcome": "manual_review",
      "priority": 50
    },
    {
      "field": "payment_type",
      "operator": "in",
      "value": ["crypto"],
      "outcome": "manual_review",
      "priority": 10
    }
  ],
  "isActive": true
}
```

---

## Files

| File | Description |
|------|-------------|
| `src/services/refund-engine.ts` | Core refund engine |
| `src/queue/refund-queue.ts` | Background queue processor |
| `src/services/refund-notifications.ts` | Notification dispatcher |
| `src/routes/refunds-automated.ts` | API routes |
| `src/services/__tests__/refund-engine.test.ts` | Engine tests |
| `src/services/__tests__/refund-notifications.test.ts` | Notification tests |
| `src/queue/__tests__/refund-queue.test.ts` | Queue tests |
| `src/routes/__tests__/refunds-automated.test.ts` | Route tests |
