# PCI DSS Compliance Dashboard

Issue: **#924 — Build PCI DSS compliance dashboard**

The PCI DSS dashboard turns a catalogue of PCI DSS v4.0 requirements and controls
into an evidence-backed compliance posture: a per-requirement status, a weighted
overall score, evidence coverage, and a prioritised remediation backlog.

## Implementation

| Layer | Location |
| --- | --- |
| Assessment engine | `backend/src/services/pci-dss.ts` |
| HTTP API | `backend/src/routes/pci-dss.ts` (mounted at `/api/v1/pci-dss`) |
| Dashboard UI | `frontend/app/dashboard/compliance/pci-dss/page.tsx` |
| Tests | `backend/src/services/__tests__/pci-dss.test.ts` |

## Model

The catalogue defines the twelve PCI DSS v4.0 top-level **requirements**, each
with a set of **controls** that carry a priority, a framework reference and
remediation guidance. Every control has one of four statuses:

| Control status | Meaning |
| --- | --- |
| `in_place` | Control is implemented and evidenced |
| `not_in_place` | Control is missing or failed |
| `not_tested` | Control exists but has not been verified |
| `not_applicable` | Control is out of scope for this environment |

Requirement status is derived from its controls:

- any `not_in_place` → `non_compliant`
- else any `not_tested` → `in_place_with_deficiencies`
- else (all `in_place`) → `compliant`
- all controls `not_applicable` → `not_applicable`

`compliancePercent` is the share of applicable controls that are `in_place`. The
dashboard's `overallScore` is the requirement-weighted average of those
percentages, and `evidenceCoverage` is the share of applicable controls that have
been tested (`in_place` or `not_in_place` rather than `not_tested`).

## API

- `GET /api/v1/pci-dss/dashboard` — full dashboard (score, counts, requirements, gaps).
  Optional `?assessedBy=` for the report attribution.
- `GET /api/v1/pci-dss/requirements` — per-requirement assessments with controls.
- `GET /api/v1/pci-dss/gaps?priority=high|medium|low` — prioritised gaps.
- `GET /api/v1/pci-dss/controls/:id` — a single control (`404` when unknown).
- `PATCH /api/v1/pci-dss/controls/:id` — record evidence:

  ```json
  { "status": "in_place", "evidence": "KMS rotation documented" }
  ```

- `POST /api/v1/pci-dss/reset` — restore the default sample posture.
- `GET /api/v1/pci-dss/export/evidence.csv` — CSV of every control and its evidence.

## UI

The dashboard page at `/dashboard/compliance/pci-dss` shows the overall score,
requirement-level status table, and the prioritised remediation gap list. It
reads the backend dashboard endpoint and refreshes on demand.

## Notes and limitations

- Control statuses are held in memory and seeded with a realistic sample posture
  so the dashboard renders immediately. Wire `setControlStatus()` to the audit
  trail / database for durable, attested evidence.
- The catalogue is a representative subset of PCI DSS v4.0 controls intended for
  dashboarding; it is not a substitute for a formal Report on Compliance (ROC).
