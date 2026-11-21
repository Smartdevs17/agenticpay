# Funnel Conversion Tracking — Issue #853

## Overview
Custom funnel definitions with step ordering, conversion window, per-step stats and user journey tracking.

## Service
`backend/src/services/funnel-tracking.ts` — `FunnelTrackingService`

### FunnelDefinition
```ts
{
  id: string,
  name: string,
  steps: [{ id, name, order }],
  conversionWindowMs: number // default 7d
}
```

### API

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/funnels | Create funnel |
| GET | /api/v1/funnels | List funnels |
| GET | /api/v1/funnels/:funnelId | Get funnel |
| PATCH | /api/v1/funnels/:funnelId | Update funnel |
| DELETE | /api/v1/funnels/:funnelId | Delete funnel |
| POST | /api/v1/funnels/:funnelId/track | Track event `{ userId, stepId, timestamp? }` |
| GET | /api/v1/funnels/:funnelId/stats?since=&until=&conversionWindowMs= | Stats with conversion rates |
| GET | /api/v1/funnels/:funnelId/journey/:userId | User journey |
| GET | /api/v1/funnels/:funnelId/export | CSV export |

### Stats Example
```json
{
  "totalUsers": 100,
  "totalConverted": 30,
  "overallConversionRate": 0.3,
  "steps": [
    { "stepId": "visit", "entered": 100, "conversionRate": 1, "stepConversionRate": 1 },
    { "stepId": "checkout", "entered": 60, "conversionRate": 0.6, "stepConversionRate": 0.6, "dropOffRate": 0.4 },
    { "stepId": "purchase", "entered": 30, "conversionRate": 0.3, "stepConversionRate": 0.5 }
  ],
  "avgTotalConversionTimeMs": 45000
}
```

## Testing
`backend/src/services/__tests__/funnel-tracking.test.ts`
