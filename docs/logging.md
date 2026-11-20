# Structured Logging (#409)

AgenticPay backend uses **Pino** for JSON structured logs with correlation IDs.

## Fields

| Field | Source |
|-------|--------|
| `traceId` | `X-Trace-Id` header or generated UUID |
| `requestId` | `x-request-id` header or generated UUID |
| `module` | Per-module child loggers (`webhooks`, `prisma`, …) |

## Configuration

```env
LOG_LEVEL=info
LOG_LEVELS=webhooks:debug,prisma:warn
```

## Local log aggregation (Loki + Grafana)

```bash
docker compose up -d loki grafana
```

- Grafana: http://localhost:3002 (admin / admin)
- Query: `{service="agenticpay-backend"}` in Explore → Loki

Ship production logs with Promtail or your cloud log agent targeting Loki.

## PII redaction

Emails, API keys, Bearer tokens, and card-like numbers are redacted in log formatters. Sensitive object keys (`password`, `secret`, `token`, …) are censored. Card-like numbers must pass a Luhn check, so 13-digit epoch-millisecond timestamps are not redacted.

### Tenant-scoped redaction (#1492)

Both the console logger (`backend/src/utils/logger.ts`) and the pino request logger use the same redaction function. Once a request is authenticated, its tenant ID is on the log context, and that tenant's registered policy adds extra sensitive keys and patterns. The base rules always apply, and a policy cannot remove them. See [Request and data hardening](security/request-hardening.md#3-tenant-scoped-pii-redaction-1492) for the policy API.
