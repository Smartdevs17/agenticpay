# AML Transaction Monitoring with Risk Scoring

Issue: **#922 — Implement AML transaction monitoring with risk scoring**

AgenticPay screens every payment against a deterministic, explainable AML rule
engine. Each transaction receives a `0-100` risk score, a risk level, the list of
rules that fired, and a recommended action. High and critical assessments
generate alerts that can be triaged through the API.

## Implementation

| Layer | Location |
| --- | --- |
| Rule engine + scoring | `backend/src/services/aml/transaction-monitor.ts` |
| HTTP API | `backend/src/routes/aml-monitoring.ts` (mounted at `/api/v1/aml`) |
| Tests | `backend/src/services/aml/__tests__/transaction-monitor.test.ts` |

## Risk levels

Scores are capped at `100` and mapped to levels:

| Level | Score band | Recommended action |
| --- | --- | --- |
| `low` | `0-19` | `allow` |
| `medium` | `20-39` | `monitor` |
| `high` | `40-69` | `review` |
| `critical` | `70-100` | `block_and_report` |

Any assessment that is `critical` **or** that matches the sanctions-exposure
rule sets `requiresSarFiling: true`, prompting a Suspicious Activity Report.

## Rules

Every rule contributes a fixed weight to the score. Weights are additive and the
total is clamped to `100`, so multiple weak signals compound into a stronger
recommendation.

| Rule | Weight | What it catches |
| --- | --- | --- |
| `sanctions_exposure` | 70 | Counterparty appears on a sanctions watchlist |
| `pep_exposure` | 30 | Counterparty is a politically exposed person |
| `structuring` | 35 | Amounts just below the CTR threshold, or repeated near-threshold activity |
| `ctr_threshold_breach` | 20 | Amount meets/exceeds the CTR reporting threshold (`$10,000`) |
| `unusually_large_amount` | 15 | Amount above the high-value monitoring threshold (`$25,000`) |
| `velocity_per_hour` | 25 | More than 10 transactions from the account in one hour |
| `velocity_per_day` | 15 | More than 40 transactions from the account in 24 hours |
| `fan_out` | 20 | More than 10 distinct counterparties in 24 hours |
| `amount_spike` | 15 | Amount at least 5x the account baseline |
| `unverified_account` | 25 | Account has not completed KYC |
| `new_account_high_value` | 15 | Account under 30 days old moving high-value amounts |
| `unusual_hour` | 10 | Activity between 00:00-06:00 UTC |
| `round_amount` | 5 | Large round-number transfer |
| `unknown_counterparty` | 10 | First-time counterparty |
| `high_risk_jurisdiction` | 20 | Origin or destination on the high-risk country list |

Call `GET /api/v1/aml/rules` for the live catalogue and thresholds.

## API

### `POST /api/v1/aml/score`

Scores a single transaction, optionally with account context.

```json
{
  "transaction": {
    "transactionId": "tx_1",
    "accountId": "acct_1",
    "counterpartyId": "cp_1",
    "amount": 9500,
    "currency": "USD",
    "timestamp": 1767225600000
  },
  "account": {
    "accountId": "acct_1",
    "kycVerified": true,
    "knownCounterparties": ["cp_1"]
  }
}
```

Response (`data`) is an `AmlAssessment`:

```json
{
  "transactionId": "tx_1",
  "accountId": "acct_1",
  "score": 35,
  "level": "medium",
  "matches": [{ "ruleId": "structuring", "weight": 35, "severity": "high" }],
  "recommendedAction": "monitor",
  "requiresSarFiling": false,
  "assessedAt": "2026-01-02T14:30:00.000Z"
}
```

### `POST /api/v1/aml/monitor`

Batch endpoint. Scores `transactions` (with an optional `accounts` context array)
and automatically creates alerts for `high`/`critical` assessments.

### `GET /api/v1/aml/alerts`

Lists alerts, newest first. Supports `?status=`, `?severity=` and `?accountId=`
filters.

### `PATCH /api/v1/aml/alerts/:id`

Moves an alert to `under_review`, `resolved`, or `dismissed`:

```json
{ "status": "resolved", "reviewedBy": "analyst-1", "resolution": "legitimate payroll" }
```

Returns `404` when the alert does not exist and rejects re-finalising an
already-resolved alert.

## Notes and limitations

- The alert store is in-memory; wire it to the database for durable retention.
- The rule engine is intentionally synchronous and dependency-free so it can run
  on the payment hot path without blocking.
- Thresholds live in `AML_THRESHOLDS` and are exposed read-only through the API.
