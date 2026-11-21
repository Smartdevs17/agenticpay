# Jurisdiction-Aware Tax Automation

Issue #627. Adds a jurisdiction-aware tax **rule engine** on top of the
pre-existing tax **reporting** service (Issue #351, `tax-reports.ts`). The
two services are complementary and stay separate:

- `backend/src/services/tax-reports.ts` (`TaxReportService`, singleton
  `taxReportService`) — records `TaxableTransaction`s and produces
  after-the-fact documents: year summaries, US 1099-K, VAT reports,
  economic-nexus detection, CSV export.
- `backend/src/services/tax/tax-engine.ts` (`TaxRuleEngine`, singleton
  `taxRuleEngine` from `backend/src/services/tax/index.ts`) — the
  forward-looking piece: per-jurisdiction rate rules, automated
  per-transaction tax calculation, exemption handling, compliance checks,
  and an audit trail of every calculation performed.

Routes for both live in the same router: `backend/src/routes/tax.ts`
(`taxRouter`, mounted at `/api/v1/tax` in `backend/src/index.ts`). The
pre-existing routes (`/summary`, `/1099-k`, `/vat`, `/nexus`, `/export`,
`/track`) are untouched; this document also covers them for completeness.

## Data model

Three Prisma models back the engine (`prisma/schema.prisma`, already
migrated):

- **`TaxJurisdictionRule`** — a rate rule for a jurisdiction: `jurisdiction`,
  `name`, `ruleType` (`vat | gst | sales_tax | withholding`), `rate`
  (fraction, e.g. `0.20` for 20%, `Decimal(7,6)`), optional `appliesAbove`
  (a minimum taxable amount below which the rule doesn't apply), `active`,
  and an effective window (`effectiveFrom` / `effectiveTo?`). Not tenant- or
  merchant-scoped — a jurisdiction's tax rate is a fact about that
  jurisdiction, not about any one merchant.
- **`TaxExemption`** — a `tenantId` + `merchantId` + `jurisdiction` grant
  that zeroes out tax for calculations in that scope, with its own validity
  window (`validFrom` / `validTo?`), a `reason`, and an optional
  `certificateId` for the physical/digital exemption certificate reference.
- **`TaxCalculationAuditLog`** — one immutable row per `calculate()` call:
  what was taxed, at what rate, by which rule (or exemption), and the
  resulting amount. Never updated or deleted by the engine — exemptions are
  *revoked* (soft-deactivated) rather than deleted, and the audit trail keeps
  every past calculation as evidence of what was actually charged, even if
  the underlying rule or exemption is later changed.

### Postgres vs. in-memory fallback

Like `services/archival/archival-service.ts` and `services/fx/fx-service.ts`,
`TaxRuleEngine` gates all persistence behind
`usePrisma() { return Boolean(process.env.DATABASE_URL) }`. When
`DATABASE_URL` is unset (this repo's default test run), rules, exemptions,
and audit log entries are kept in in-memory arrays scoped to the
`TaxRuleEngine` instance instead of the Prisma tables — so the whole engine
is unit-testable without a live Postgres connection. Call `resetForTests()`
to clear in-memory state between tests.

## How jurisdiction + effective dates + rate resolve

`TaxRuleEngine.calculate({ tenantId, merchantId, jurisdiction, amount,
currency, paymentId?, at? })` resolves a rate as follows:

1. **Exemption check first.** Look up an active `TaxExemption` for
   `tenantId` + `merchantId` + `jurisdiction` whose validity window
   (`validFrom` <= `at` <= `validTo` or no `validTo`) covers `at` (default:
   now). If one is found, the calculation short-circuits: `taxAmount: 0`,
   `rate: 0`, `exempt: true`, `exemptionId` set, and no rule is consulted. If
   more than one exemption matches, the most recently created one wins.
2. **Rule lookup.** Otherwise, find `TaxJurisdictionRule` rows for the
   (uppercased) `jurisdiction` where `active: true` and the effective window
   covers `at` (`effectiveFrom <= at` and `effectiveTo` is null or `>= at`).
   If more than one rule matches (e.g. a rate change was entered with
   overlapping windows — see Compliance checks below), the rule with the
   **latest `effectiveFrom`** wins ("most recently started rule takes
   precedence"); ties break on `createdAt` (most recently created wins).
3. **Threshold.** If the winning rule has `appliesAbove` set and
   `amount < appliesAbove`, tax is `0` (the transaction is below the rule's
   minimum) but the rule is still recorded as `ruleFound: true` /
   `ruleId` set, distinct from "no rule at all."
4. **No match.** If no active rule covers the jurisdiction at `at`, the
   calculation returns `taxAmount: 0`, `ruleFound: false`, `ruleId: null`.
   This is intentionally **not** an error — a payment shouldn't fail because
   tax configuration is incomplete — but it is recorded in the audit trail
   and surfaced by `checkCompliance()` (see below) so the gap gets fixed.
5. **Audit log.** Every call to `calculate()` — exempt, rule-matched, or
   no-rule — writes one `TaxCalculationAuditLog` row with the resolved
   `taxableAmount`, `taxAmount`, `rate`, `ruleId`/`exemptionId`, `exempt`
   flag, and `currency`.

Rates are always fractions (`0.20`, not `20`), consistent with
`generateVatReport`'s `rate` option in `tax-reports.ts`.

**Scope note:** the engine currently resolves a single applicable rule per
calculation. Jurisdictions that legitimately stack multiple simultaneous tax
types on the same transaction (e.g. VAT *and* a withholding tax) aren't
combined automatically — model each as a separate `ruleType` and, if
stacking is needed later, extend `calculate()` to accept a `ruleType` filter
and call it once per applicable type, or extend `findApplicableRule` to
return and sum multiple rule types. This is a deliberate scope cut for
#627, not an oversight.

## Exemption lifecycle

1. **Create** (`createExemption` / `POST /exemptions`) — requires
   `tenantId`, `merchantId`, `jurisdiction`, `reason`; optional
   `certificateId`, `validFrom` (defaults to now), `validTo` (open-ended if
   omitted). Created exemptions start `active: true`.
2. **Applies automatically** — every `calculate()` call checks for a
   covering active exemption before consulting rate rules (see above). No
   separate "apply exemption" step is needed.
3. **Expiry** — an exemption whose `validTo` has passed simply stops
   matching in `calculate()` (the validity-window check excludes it), even
   though `active` is still `true` in storage. `active` and "currently
   valid" are two different questions: `active` means "not revoked",
   `validFrom <= now <= validTo` means "currently in effect."
4. **Revoke** (`revokeExemption` / `DELETE /exemptions/:id`) — a soft
   delete: sets `active: false`. Revoked exemptions are excluded from
   `calculate()` and from `listExemptions({ activeOnly: true })`, but the
   row (and every audit log entry that referenced it) is retained.
5. **Compliance signal** — `checkCompliance()` flags exemptions that are
   still `active: true` but whose `validTo` has already passed
   (`EXPIRED_EXEMPTION_ACTIVE`), since these represent certificates that
   should have been revoked or renewed and are a paper-trail risk even
   though `calculate()` already stops honoring them once expired.

## Compliance checks

`checkCompliance({ tenantId, merchantId, jurisdiction? })` returns a
structured finding list plus an overall `compliant` boolean (`true` iff no
`critical`-severity finding is present). Three checks run:

| Code | Severity | Trigger |
|---|---|---|
| `NO_ACTIVE_RULE` | `warning` | A jurisdiction appears in this tenant/merchant's audit trail (i.e. a calculation was performed there) but no `TaxJurisdictionRule` is currently active for it. |
| `EXPIRED_EXEMPTION_ACTIVE` | `critical` | An exemption for this tenant/merchant (+ jurisdiction, if filtered) has `active: true` but `validTo` in the past. |
| `OVERLAPPING_RULE_WINDOWS` | `critical` | Two active rules for the same jurisdiction + `ruleType` have overlapping effective windows, making rate resolution ambiguous/order-dependent. |

Each finding carries `code`, `severity`, a human-readable `message`,
`jurisdiction` (when applicable), and a `details` object with the relevant
IDs. `NO_ACTIVE_RULE` is scoped to jurisdictions actually seen in the audit
trail (bounded by `jurisdiction` if the caller passes one) rather than every
jurisdiction on earth, so the check stays relevant to a given
tenant/merchant's real activity. `OVERLAPPING_RULE_WINDOWS` scans the global
rule table (optionally filtered to one jurisdiction), since rules aren't
tenant-scoped.

## Audit trail

`getAuditTrail({ tenantId, merchantId?, jurisdiction?, since?, until?,
limit?, offset? })` reads `TaxCalculationAuditLog`, newest first, with
optional filters and pagination (`limit` defaults to 50, capped at 500;
`offset` defaults to 0). Returns `{ entries, total }` so callers can page
through history.

Every row is immutable — the engine never updates or deletes audit log
entries; a later rule change or exemption revocation does not rewrite past
calculations, only affects future ones. Fields: `id`, `tenantId`,
`merchantId`, `paymentId` (nullable — set when the calculation was for a
specific payment), `jurisdiction`, `taxableAmount`, `taxAmount`, `rate`,
`ruleId` (nullable), `exemptionId` (nullable), `exempt`, `currency`,
`createdAt`.

**Retention:** no separate retention job exists yet for
`TaxCalculationAuditLog` (unlike `TaxReportService`'s documents, which carry
an explicit 7-year `RetentionPolicy`). Tax calculation records are
transactional evidence of amounts actually charged and should be retained
at least as long as the underlying payment/tax records are retained under
applicable law (commonly 6–7 years) — follow the same `RETENTION_YEARS = 7`
convention used in `tax-reports.ts` and `archival-service.ts` if/when a
retention/archival job is added for this table.

## Automated calculation hook (integration point)

`taxRuleEngine.calculate(...)` is intentionally a small, pure, cleanly
callable function with no dependency on the payment creation flow — it was
**not** wired into payment creation as part of this change, since that
would touch shared payment files outside this issue's scope. To integrate
it later, call it from wherever a payment/invoice amount is finalized, e.g.:

```ts
import { taxRuleEngine } from '../services/tax/index.js';

const taxResult = await taxRuleEngine.calculate({
  tenantId: payment.tenantId,
  merchantId: payment.merchantId,
  jurisdiction: payment.billingJurisdiction, // ISO 3166-1 alpha-2
  amount: payment.subtotal,
  currency: payment.currency,
  paymentId: payment.id,
});

if (taxResult.ok) {
  const { taxAmount, totalAmount, exempt, ruleFound } = taxResult.value;
  // Attach taxAmount/totalAmount to the payment record; if !ruleFound,
  // consider surfacing a warning to the merchant that no jurisdiction rule
  // is configured yet (calculate() still succeeds with taxAmount: 0).
}
```

Because `calculate()` always returns a `Result` (never throws for a missing
rule) and defaults to zero tax when configuration is incomplete, it's safe
to call from a payment-creation code path without risking a failed payment
due to tax misconfiguration — the compliance-check endpoint is the intended
place to catch and fix that gap out-of-band.

## API surface

All routes are mounted at `/api/v1/tax`. Response envelope follows the rest
of the codebase: success responses are `{ "data": ... }`; errors are
`{ "error": { "code", "message", "status", "details"? } }` (via `AppError`).

### Pre-existing routes (Issue #351, unchanged)

#### `POST /api/v1/tax/track`

Ingest a taxable transaction into `TaxReportService`.

```http
POST /api/v1/tax/track
{ "merchantId": "m_1", "id": "tx_1", "amount": 100, "currency": "USD", "jurisdiction": "US", "type": "sale" }
```
→ `201 { "ok": true }`

#### `GET /api/v1/tax/summary?merchantId=m_1&year=2025`

→ `200 { "data": { "merchantId", "year", "grossVolume", "refundVolume", "netVolume", "byCurrency", "byJurisdiction", ... } }`

#### `GET /api/v1/tax/1099-k?merchantId=m_1&year=2025`

→ `200 { "data": { "formType": "1099-K", "grossAmount", "reportingRequired", "monthlyGross", ... } }`

#### `GET /api/v1/tax/vat?merchantId=m_1&jurisdiction=GB&rate=0.2`

→ `200 { "data": { "reportType": "VAT", "taxableBase", "vatDue", ... } }`

#### `GET /api/v1/tax/nexus?merchantId=m_1&year=2025`

→ `200 { "data": [ { "jurisdiction": "US", "grossAmount": 150000, "hasNexus": true }, ... ] }`

#### `GET /api/v1/tax/export?merchantId=m_1&type=summary`

→ `200` CSV file (`Content-Type: text/csv`).

### New routes (Issue #627)

#### `POST /api/v1/tax/jurisdiction-rules`

Create a jurisdiction tax rule.

```http
POST /api/v1/tax/jurisdiction-rules
{
  "jurisdiction": "DE",
  "name": "Germany VAT standard rate",
  "ruleType": "vat",
  "rate": 0.19,
  "effectiveFrom": "2024-01-01T00:00:00Z"
}
```
→ `201`
```json
{
  "data": {
    "id": "…", "jurisdiction": "DE", "name": "Germany VAT standard rate",
    "ruleType": "vat", "rate": 0.19, "appliesAbove": null, "active": true,
    "effectiveFrom": "2024-01-01T00:00:00.000Z", "effectiveTo": null,
    "metadata": null, "createdAt": "…", "updatedAt": "…"
  }
}
```

#### `GET /api/v1/tax/jurisdiction-rules?jurisdiction=DE&ruleType=vat&activeOnly=true&at=2025-01-01T00:00:00Z`

List/filter rules. All query params optional. `at` filters to rules whose
effective window covers that instant.

→ `200 { "data": [ { ...rule }, ... ] }`

#### `PATCH /api/v1/tax/jurisdiction-rules/:id`

Partial update — any subset of `name`, `ruleType`, `rate`, `appliesAbove`,
`active`, `effectiveFrom`, `effectiveTo`, `metadata`. Send `active: false`
to deactivate a rule (equivalent to `deactivateRule()`).

```http
PATCH /api/v1/tax/jurisdiction-rules/rule_123
{ "rate": 0.20 }
```
→ `200 { "data": { ...updated rule } }`

#### `POST /api/v1/tax/calculate`

Automated tax calculation for a payment or arbitrary amount.

```http
POST /api/v1/tax/calculate
{
  "tenantId": "t_1", "merchantId": "m_1", "jurisdiction": "DE",
  "amount": 100, "currency": "EUR", "paymentId": "pay_123"
}
```
→ `200`
```json
{
  "data": {
    "taxableAmount": 100, "taxAmount": 19, "totalAmount": 119,
    "rate": 0.19, "currency": "EUR", "jurisdiction": "DE",
    "exempt": false, "exemptionId": null, "ruleId": "…", "ruleName": "Germany VAT standard rate",
    "ruleFound": true, "auditLogId": "…", "createdAt": "…"
  }
}
```

#### `GET /api/v1/tax/reporting/:jurisdiction?merchantId=m_1&year=2025`

Tax reporting for one jurisdiction. Reuses
`taxReportService.getYearSummary(...)`'s `byJurisdiction` breakdown (rather
than re-aggregating transactions) and layers the jurisdiction's currently
active rate rules on top.

→ `200`
```json
{
  "data": {
    "merchantId": "m_1", "jurisdiction": "DE", "year": 2025,
    "reportingCurrency": "USD",
    "breakdown": { "jurisdiction": "DE", "gross": 5000, "refunds": 0, "net": 5000, "count": 12 },
    "activeRules": [ { "id": "…", "ruleType": "vat", "rate": 0.19, ... } ],
    "warnings": [], "retention": { "retentionYears": 7, "retainUntil": "…" },
    "generatedAt": "…"
  }
}
```

#### `GET /api/v1/tax/compliance?tenantId=t_1&merchantId=m_1&jurisdiction=DE`

`jurisdiction` optional (omitting it checks all jurisdictions seen in the
audit trail).

→ `200`
```json
{
  "data": {
    "tenantId": "t_1", "merchantId": "m_1", "jurisdiction": "DE",
    "checkedAt": "…",
    "findings": [
      { "code": "NO_ACTIVE_RULE", "severity": "warning", "message": "…", "jurisdiction": "JP" }
    ],
    "compliant": true
  }
}
```

#### `POST /api/v1/tax/exemptions`

```http
POST /api/v1/tax/exemptions
{
  "tenantId": "t_1", "merchantId": "m_1", "jurisdiction": "US",
  "reason": "Registered non-profit", "certificateId": "CERT-001",
  "validFrom": "2025-01-01T00:00:00Z"
}
```
→ `201 { "data": { "id": "…", "active": true, "validTo": null, ... } }`

#### `GET /api/v1/tax/exemptions?tenantId=t_1&merchantId=m_1&jurisdiction=US&activeOnly=true`

All query params optional.

→ `200 { "data": [ { ...exemption }, ... ] }`

#### `DELETE /api/v1/tax/exemptions/:id`

Revokes (soft-deletes) an exemption.

→ `200 { "data": { "id": "…", "active": false, ... } }`

#### `GET /api/v1/tax/audit-trail?tenantId=t_1&merchantId=m_1&jurisdiction=US&since=2025-01-01T00:00:00Z&limit=50&offset=0`

`tenantId` required; all other params optional.

→ `200`
```json
{
  "data": {
    "entries": [ { "id": "…", "taxableAmount": 100, "taxAmount": 19, "exempt": false, "ruleId": "…", "createdAt": "…" } ],
    "total": 137
  }
}
```

## Automated Tax Reporting (Issues #690–#693)

The automated tax reporting subsystem builds on the tax rule engine to
provide jurisdiction-aware report generation, multi-format export, and
filing deadline management.

### Architecture

```
tax-engine.ts          — jurisdiction rules, rate calculation, compliance
automated-tax-report.ts — report generation, lifecycle, batch processing
tax-export.ts          — multi-format export (CSV, JSON, PDF, XLSX)
tax-calendar.ts        — filing deadline tracking, alerts, templates
tax-reporting.ts       — REST API routes for all the above
```

### Report Generation (`AutomatedTaxReportService`)

`generateReport({ tenantId, merchantId, period, year, periodNumber?, jurisdictions?, reportingCurrency? })`

1. Collects all `TaxableTransaction`s for the merchant within the period.
2. Aggregates by jurisdiction (gross, refunds, net, count).
3. For each jurisdiction with activity, looks up the applicable tax rule
   via `TaxRuleEngine.listRules()` and computes tax on the net amount.
4. Checks for active exemptions — if one exists, tax is zeroed.
5. Computes a `complianceScore` (percentage of jurisdictions with active
   rules) and emits `warnings` for uncovered jurisdictions.
6. Persists the report (Prisma or in-memory) with status `draft`.

**Period support:** `monthly` (1–12), `quarterly` (1–4), `annual` (1).

**Report types** are inferred from jurisdiction rule types:
`vat`, `gst`, `sales_tax`, `withholding`, or `consolidated` (mixed).

### Filing Reports

`generateFilingReport({ tenantId, merchantId, year })` produces a
consolidated annual report with per-jurisdiction summaries including:
- `filingFrequency` — jurisdiction-aware: monthly (DE, FR, IN),
  quarterly (US, GB, CA, AU), annual (JP)
- `nextDeadline` — computed from known filing deadline patterns for
  each supported jurisdiction

### Report Lifecycle

```
draft → finalized → archived
```

- `finalizeReport(id)` — locks the report, records `finalizedAt`
- `archiveReport(id)` — moves to long-term retention

### Batch Generation

`generateScheduledReports({ tenantId, merchantIds, period, year })`
generates reports for multiple merchants in one call, returning
`{ generated, failed, reportIds }`.

### Multi-Format Export (`TaxExportService`)

Exports any report type to 4 formats:

| Format | MIME Type | Notes |
|--------|-----------|-------|
| CSV | `text/csv` | Configurable delimiter |
| JSON | `application/json` | Full structured data |
| PDF | `application/pdf` | Text-based (no external deps) |
| XLSX | `application/vnd.ms-excel` | XML Spreadsheet format |

Exportable types: `TaxReport`, `FilingReport`, `TaxYearSummary`, `Form1099K`.

### Tax Calendar (`TaxCalendarService`)

Manages filing deadlines with:
- **CRUD** for per-merchant, per-jurisdiction deadlines
- **Status tracking:** `upcoming` → `due_soon` → `overdue` → `completed`
- **Alerts** with severity levels (`info`, `warning`, `critical`, `overdue`)
- **Default templates** for 8 jurisdictions: US, GB, DE, FR, CA, AU, JP, IN
- **Template-based creation** for quick deadline setup

### Supported Jurisdictions

| Jurisdiction | Tax Type | Rate | Filing Frequency |
|-------------|----------|------|-----------------|
| US | sales_tax | configurable | Quarterly |
| GB | vat | configurable | Quarterly |
| DE | vat | configurable | Monthly |
| FR | vat | configurable | Monthly |
| CA | gst | configurable | Quarterly |
| AU | gst | configurable | Quarterly |
| JP | withholding | configurable | Annual |
| IN | gst | configurable | Monthly |

## Tests

- `backend/src/services/__tests__/tax-engine.test.ts` — rule CRUD, rate
  resolution, compliance checks, audit trail (13 tests)
- `backend/src/services/__tests__/automated-tax-report.test.ts` — report
  generation, filing reports, lifecycle, batch processing, jurisdiction-aware
  filing frequencies, report accuracy (30+ tests)
- `backend/src/services/__tests__/tax-export.test.ts` — all 4 export formats
  for all 4 report types (18 tests)
- `backend/src/services/__tests__/tax-calendar.test.ts` — deadline CRUD,
  alerts, templates, status refresh (17 tests)
- `backend/src/routes/__tests__/tax-reporting.test.ts` — integration tests
  for all REST endpoints (13 tests)
- `backend/benchmarks/tax-calculation.bench.ts` — performance benchmarks
  (4 benchmarks)

All tests run against the in-memory fallback (no `DATABASE_URL` needed).
