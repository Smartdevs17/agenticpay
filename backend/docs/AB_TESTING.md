# A/B Testing Framework — Issue #852

## Overview
Generic experiment framework with deterministic assignment, statistical significance and lifecycle.

## Service
`backend/src/services/ab-testing.ts` — `ABTestingService`

### Experiment
```ts
{
  id, name, description, hypothesis,
  variants: [{ key, name, weight, isControl, payload }],
  primaryMetric: 'conversion',
  trafficAllocation: 100,
  status: 'draft'|'running'|'paused'|'completed'|'archived'
}
```

### API
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/ab-tests | Create |
| GET | /api/v1/ab-tests?status= | List |
| GET | /api/v1/ab-tests/:id | Get |
| PATCH | /api/v1/ab-tests/:id | Update (draft only) |
| DELETE | /api/v1/ab-tests/:id | Delete |
| POST | /api/v1/ab-tests/:id/start, /pause, /complete, /archive | Lifecycle |
| POST | /api/v1/ab-tests/:id/assign | `{ subjectId }` |
| GET | /api/v1/ab-tests/:id/assign/:subjectId | Assign |
| POST | /api/v1/ab-tests/:id/exposure | Mark exposed |
| POST | /api/v1/ab-tests/:id/track | `{ subjectId, metric?, value? }` |
| GET | /api/v1/ab-tests/:id/results | Results with pValue, CI, winner |
| GET | /api/v1/ab-tests/:id/bayesian | Bayesian prob beats control |
| POST | /api/v1/ab-tests/utils/sample-size | `{ baselineRate, mde }` |

### Stats
- Two-proportion z-test (pooled)
- Wilson score interval
- Bayesian Beta-Binomial (normal approx)
- Sample size calculator

### Example Results
```json
{
  "winner": "treatment",
  "variants": [
    { "key": "control", "participants": 100, "conversionRate": 0.12, "confidenceInterval": [0.06, 0.18] },
    { "key": "treatment", "participants": 98, "conversionRate": 0.22, "lift": 0.1, "pValue": 0.03, "isSignificant": true, "isWinner": true }
  ],
  "recommendation": "Variant treatment is winner..."
}
```
