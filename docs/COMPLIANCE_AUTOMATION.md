# Compliance Automation

AgenticPay now includes an automated compliance layer for replacing manual compliance review with repeatable checks, regulatory monitoring, evidence capture, reports, alerts, and dashboard summaries.

## Capabilities

- **Automated compliance checks** — security, operations, audit integrity, regulatory monitoring, reporting, dashboard, and documentation controls are evaluated through `/api/v1/compliance/status` or `/api/v1/compliance/checks/run`.
- **Regulatory update monitoring** — bundled official watchlist sources are tracked and optional live feed URLs can be configured with `COMPLIANCE_REGULATORY_FEEDS`.
- **Compliance reporting** — JSON and CSV reports are generated at `/api/v1/compliance/reports`.
- **Compliance alerts** — failed/warning checks and regulatory updates create lifecycle-managed alerts at `/api/v1/compliance/alerts`.
- **Compliance audit trail** — all runs, report generation, regulatory monitoring, update ingestion, and alert state changes are recorded through the immutable audit service using `resource=compliance`.
- **Compliance dashboard** — `/api/v1/compliance/dashboard` returns score, status, open alerts, recent regulatory updates, top risks, and required actions.
- **Compliance documentation** — `/api/v1/compliance/documentation` exposes endpoint and control documentation for auditors.

## Scheduled Jobs

Two scheduled jobs are registered in the central scheduler:

| Job | Default schedule | Purpose |
| --- | --- | --- |
| `automated-compliance-checks` | `0 * * * *` | Runs all automated compliance controls hourly and emits alerts. |
| `regulatory-update-monitoring` | `0 */6 * * *` | Checks regulatory feeds every six hours and records changes. |

Schedules can be overridden with the existing convention:

```bash
SCHEDULE_OVERRIDE_AUTOMATED_COMPLIANCE_CHECKS="*/15 * * * *"
SCHEDULE_OVERRIDE_REGULATORY_UPDATE_MONITORING="0 * * * *"
```

## Optional Environment Variables

| Variable | Purpose |
| --- | --- |
| `COMPLIANCE_REGULATORY_FEEDS` | Comma-separated URLs to poll for changed regulatory content. |
| `COMPLIANCE_ALERT_WEBHOOK_URL` | Webhook target for compliance alerts. Falls back to `ALERT_WEBHOOK_URL` when omitted. |
| `TLS_TERMINATION_VERIFIED` | Set to `true` in production after HTTPS-only ingress is verified. |
| `BACKUP_ENABLED` / `BACKUP_PROVIDER` | When backups are enabled, provider configuration is validated by compliance checks. |

## Main API Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/compliance/status` | Run checks and return current status. |
| `GET` | `/api/v1/compliance/checks` | List latest and historical compliance runs. |
| `POST` | `/api/v1/compliance/checks/run` | Force a new run. |
| `GET` | `/api/v1/compliance/regulatory-sources` | List configured regulatory sources. |
| `GET` | `/api/v1/compliance/regulatory-updates` | List captured regulatory updates. |
| `POST` | `/api/v1/compliance/regulatory-updates/monitor` | Run regulatory monitoring immediately. |
| `POST` | `/api/v1/compliance/regulatory-updates/ingest` | Manually ingest a reviewed regulatory update. |
| `GET` | `/api/v1/compliance/reports?format=json\|csv` | Generate a compliance report. |
| `GET` | `/api/v1/compliance/alerts` | List compliance alerts. |
| `POST` | `/api/v1/compliance/alerts/:id/acknowledge` | Acknowledge an alert. |
| `POST` | `/api/v1/compliance/alerts/:id/resolve` | Resolve an alert. |
| `GET` | `/api/v1/compliance/audit-trail` | Return compliance audit evidence. |
| `GET` | `/api/v1/compliance/dashboard` | Dashboard summary for compliance teams. |
| `GET` | `/api/v1/compliance/documentation` | Machine-readable compliance documentation. |

## Audit Evidence

The compliance service writes immutable audit records for:

- compliance check runs,
- regulatory monitoring runs,
- regulatory update ingestion,
- alert creation / acknowledgement / resolution,
- report generation.

Use `/api/v1/compliance/audit-trail` for compliance-specific evidence or `/api/v1/compliance/evidence/audit/export?format=csv` for a full audit export.
