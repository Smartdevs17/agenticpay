# Merchant Onboarding with Risk Tiering

Issue #928.

Every merchant is assigned a **risk tier** (`low`, `medium`, `high`, `critical`)
during onboarding. The tier is derived from a deterministic scoring model over
business, financial, and compliance signals, and it drives the merchant's
transaction limits, payout hold period, and required onboarding checks.

## Scoring model

`scoreMerchantRisk(signals)` produces a `0..100` score (higher = riskier).
Each factor contributes a bounded number of points so no single extreme signal
can saturate the score:

| Signal | Contribution |
| --- | --- |
| Business age | up to 20 points (newer = riskier) |
| Chargebacks (90d) | 5 points each, capped at 25 |
| Refund rate above 5% | 1.5 points per point, capped at 15 |
| Monthly volume | up to 15 points |
| Missing KYC | 12 points |
| Missing KYB | 12 points |
| Sanctions hits | 30 points |
| Jurisdiction risk | up to 10 points |

Tier thresholds: `low < 18`, `medium 18–39`, `high 40–64`, `critical ≥ 65`.

## Tier policies

| Tier | Max transaction | Daily limit | Payout hold | Manual review |
| --- | --- | --- | --- | --- |
| low | $50,000 | $250,000 | 2 days | no |
| medium | $20,000 | $75,000 | 5 days | no |
| high | $5,000 | $20,000 | 14 days | yes |
| critical | $1,000 | $5,000 | 30 days | yes |

Each tier also declares the set of onboarding checks required before approval;
`critical` additionally requires `enhanced_due_diligence`.

## API

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/v1/merchant-risk/:merchantId/assess` | Run a risk assessment and assign a tier |
| POST | `/api/v1/merchant-risk/:merchantId/reassess` | Periodic re-scoring |
| GET | `/api/v1/merchant-risk/policies` | List all tier policies |
| GET | `/api/v1/merchant-risk/policies/:tier` | Retrieve one tier policy |
| GET | `/api/v1/merchant-risk` | List assessments (optional `?tier=`) |
| GET | `/api/v1/merchant-risk/:merchantId` | Retrieve a merchant assessment |
| POST | `/api/v1/merchant-risk/:merchantId/evaluate` | Check a transaction against tier limits |

### Assess a merchant

```http
POST /api/v1/merchant-risk/m-123/assess
Content-Type: application/json

{
  "businessAgeMonths": 3,
  "monthlyVolumeUsd": 40000,
  "chargebacks90d": 1,
  "refundRatePct": 8,
  "sanctionsHits": 0,
  "kycVerified": true,
  "kybVerified": false,
  "jurisdictionRisk": 0.2
}
```

The response includes the assigned `tier`, `score`, explanatory `factors`, and
the effective `policy`.
