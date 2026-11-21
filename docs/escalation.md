# Automated Escalation & SLA Tracking

**Issue:** [#646](https://github.com/agenticpay/agenticpay/issues/646)
**Status:** Implemented

---

## Overview

The Automated Escalation system provides configurable escalation rules and SLA tracking per issue type. It automatically elevates issues through escalation levels when response or resolution time targets are exceeded, with multi-channel notifications to ensure operators are alerted.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Escalation System                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  Escalation  │    │     SLA      │    │   Analytics      │   │
│  │    Rules     │───▶│   Tracking   │───▶│   Aggregation    │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
│         │                    │                    │              │
│         ▼                    ▼                    ▼              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  Escalation  │    │     SLA      │    │   Dashboard      │   │
│  │    Events    │    │   Breaches   │    │   (Frontend)     │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
│         │                    │                    │              │
│         ▼                    ▼                    ▼              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Notification Dispatcher                      │   │
│  │         (email, push, in-app, webhook)                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │         Cron Job (every 5 minutes)                        │   │
│  │  • Evaluates open breaches                                │   │
│  │  • Triggers escalations                                   │   │
│  │  • Aggregates analytics                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Data Models

### Enums

| Enum | Values |
|------|--------|
| `IssueType` | `dispute`, `payment_discrepancy`, `fraud_alert`, `compliance_review`, `support_ticket`, `account_issue`, `system_incident` |
| `IssueSeverity` | `low`, `medium`, `high`, `critical` |
| `EscalationLevel` | `level_1`, `level_2`, `level_3`, `management` |
| `SLAStatus` | `compliant`, `at_risk`, `breached`, `resolved` |

### Tables

| Table | Description |
|-------|-------------|
| `escalation_rules` | Configurable escalation rules per tenant/issue-type/severity |
| `issue_slas` | SLA targets (response time, resolution time) per issue type |
| `escalation_events` | Log of all escalation events with audit trail |
| `sla_breaches` | Record of SLA breaches with status tracking |
| `escalation_analytics` | Aggregated analytics data for dashboard reporting |

## Default Escalation Chains

| Issue Type | Chain |
|------------|-------|
| Dispute | Level 1 → Level 2 → Level 3 → Management |
| Payment Discrepancy | Level 1 → Level 2 → Management |
| Fraud Alert | Level 1 → Level 2 → Level 3 → Management |
| Compliance Review | Level 1 → Level 2 → Management |
| Support Ticket | Level 1 → Level 2 |
| Account Issue | Level 1 → Level 2 → Level 3 |
| System Incident | Level 1 → Level 2 → Level 3 → Management |

## Default SLA Targets (Response Time)

| Severity | Response Time | Resolution Time |
|----------|--------------|-----------------|
| Low | 8 hours (480m) | 7 days (10,080m) |
| Medium | 4 hours (240m) | 3 days (4,320m) |
| High | 1 hour (60m) | 1 day (1,440m) |
| Critical | 15 minutes (15m) | 4 hours (240m) |

## API Reference

### Base Path

```
/api/v1/escalation
```

### Escalation Rules

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/rules` | Create a new escalation rule |
| `GET` | `/rules` | List rules (optional `?issueType=dispute`) |
| `GET` | `/rules/:id` | Get a single rule |
| `PUT` | `/rules/:id` | Update a rule |
| `DELETE` | `/rules/:id` | Soft-delete a rule |
| `POST` | `/rules/seed` | Seed default rules for a tenant |

### SLA Configurations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sla` | List SLA configs |
| `PUT` | `/sla` | Create or update an SLA config |
| `DELETE` | `/sla/:id` | Soft-delete an SLA config |
| `POST` | `/sla/check` | Check SLA compliance for an issue |

### Escalation Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/events` | List events (optional `?issueId=X&issueType=Y`) |
| `GET` | `/events/:id` | Get a single event |
| `POST` | `/events/:id/acknowledge` | Acknowledge an event |

### SLA Breaches

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/breaches` | List breaches (optional `?status=breached`) |
| `POST` | `/breaches/:id/resolve` | Resolve a breach |

### Evaluation & Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/evaluate` | Evaluate escalation for an issue |
| `GET` | `/analytics` | Get analytics data |
| `POST` | `/analytics/aggregate` | Trigger aggregation |
| `GET` | `/dashboard` | Dashboard summary |

### Example: Create an Escalation Rule

```bash
curl -X POST http://localhost:3000/api/v1/escalation/rules \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-123",
    "name": "urgent_disputes",
    "issueType": "dispute",
    "severity": "critical",
    "responseTimeMins": 15,
    "resolutionTimeMins": 240,
    "escalationChain": ["level_1", "level_2", "level_3", "management"],
    "notifyChannels": [
      {"level": "level_1", "channels": ["email", "in-app"]},
      {"level": "level_2", "channels": ["email", "push", "in-app"]},
      {"level": "level_3", "channels": ["email", "push", "sms", "in-app"]},
      {"level": "management", "channels": ["email", "sms"]}
    ],
    "notifyRoles": ["admin", "operator"],
    "autoEscalate": true,
    "cooldownMins": 30
  }'
```

### Example: Check SLA Compliance

```bash
curl -X POST http://localhost:3000/api/v1/escalation/sla/check \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-123",
    "issueId": "issue-456",
    "issueType": "dispute",
    "severity": "high",
    "createdAt": "2026-07-29T08:00:00Z"
  }'
```

## Feature Flag

The escalation system is controlled by the `escalation-automation` feature flag:

```bash
# Enable (default)
FEATURE_ESCALATION_AUTOMATION=true

# Disable
FEATURE_ESCALATION_AUTOMATION=false
```

## Scheduled Job

The escalation evaluation job runs every 5 minutes:

- **Job ID:** `escalation-evaluation`
- **Schedule:** `*/5 * * * *`
- **Override:** `SCHEDULE_OVERRIDE_ESCALATION_EVALUATION=0 * * * *`

## Dashboard

The escalation dashboard is available at:

```
/dashboard/escalation
```

It displays:
- Active rules and SLA configs count
- Active breaches requiring attention
- SLA compliance ring chart
- Per-issue-type compliance bars
- Active breaches table
- Recent escalation events timeline

## Integration with Existing Systems

### Disputes

The existing dispute system (`backend/disputes/`) can be enhanced to call the escalation API when disputes are created or updated:

```typescript
// In dispute creation
await fetch('/api/v1/escalation/evaluate', {
  method: 'POST',
  body: JSON.stringify({
    tenantId: dispute.tenantId,
    issueId: dispute.id,
    issueType: 'dispute',
    severity: 'medium',
    currentLevel: 'level_1',
    createdAt: dispute.createdAt,
  }),
});
```

### Notifications

Breach and escalation notifications are dispatched through the existing `NotificationDispatcher`, which supports email, push, in-app, and webhook channels.

## Migration

Run the migration to create the new tables:

```bash
npx prisma migrate dev --name escalation_sla_tracking
```
