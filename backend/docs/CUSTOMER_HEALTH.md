# Customer Health Score — Issue #855

## Overview
Composite 0-100 health based on payment, engagement, churn, support signals.

## Service
`backend/src/services/customer-health.ts` — `CustomerHealthService`

### Factors (weighted sum)
- `payment_health` 30% — success rate, failure penalty
- `frequency` 20% — payments per 90d
- `recency` 20% — days since last success
- `engagement` 15% — logins/api_calls per 30d, inactivity penalty
- `support` 15% — tickets & cancellations

Extra penalties: 2+ fails in 7d (-15), cancellations (-20), refunds (-10)

Levels: champion >=85, healthy >=65, at_risk >=40, critical <40

Trend: improving/declining if change >5 vs previous score

### API
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/customer-health/events | `{ customerId, type, amount?, timestamp? }` |
| POST | /api/v1/customer-health/events/bulk | `{ events: [...] }` |
| GET | /api/v1/customer-health/distribution | Aggregate distribution |
| GET | /api/v1/customer-health/at-risk?threshold=40 | At-risk list |
| GET | /api/v1/customer-health/export | CSV |
| GET | /api/v1/customer-health/:customerId | Health score |
| GET | /api/v1/customer-health/:customerId/history | History |
| GET | /api/v1/customer-health/:customerId/trend?days=30 | Trend |

### Activity Types
`payment_success`, `payment_failed`, `payment_refunded`, `login`, `api_call`, `support_ticket_opened`, `support_ticket_resolved`, `subscription_cancelled`, `subscription_renewed`, `inactivity`

### Example
```json
{
  "customerId": "cust_123",
  "score": 78,
  "level": "healthy",
  "factors": [
    { "name": "payment_health", "score": 90, "weight": 0.3, "details": "9/10 success" }
  ],
  "trend": "stable",
  "riskReasons": [],
  "recommendations": ["Maintain engagement"]
}
```
