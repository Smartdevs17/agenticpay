# Chargeback Management with Evidence Submission

Issue #926.

Full lifecycle management for card and ACH chargebacks: intake, evidence
submission against a deadline, representment, notes, and outcome tracking.

## Lifecycle

```
received ──▶ under_review ──▶ evidence_required ──▶ evidence_submitted ──▶ representment ──▶ won | lost
    │              │                                                              │
    └──────────────┴──────────────────────────▶ accepted ◀────────────────────────┘
```

Only valid transitions are permitted. Reaching `won`, `lost`, or `accepted`
marks the case resolved and records `resolvedAt`.

## Evidence

Each evidence item records a `type` (`receipt`, `tracking_number`,
`delivery_proof`, `signature`, `avs_cvv_match`, `ip_location`, and more), a
free-text `description`, an optional `fileUrl`, and the submitting actor.

Evidence can only be submitted while the case is open and before
`evidenceDueBy`. The default evidence window is 7 days from intake and can be
overridden per case.

## API

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/v1/chargebacks` | Register a new chargeback case |
| GET | `/api/v1/chargebacks` | List cases (optional `?merchantId=` / `?status=`) |
| GET | `/api/v1/chargebacks/summary` | Aggregate metrics (optional `?merchantId=`) |
| GET | `/api/v1/chargebacks/:id` | Retrieve one case with evidence and timeline |
| PATCH | `/api/v1/chargebacks/:id/status` | Advance the case lifecycle |
| POST | `/api/v1/chargebacks/:id/evidence` | Submit supporting evidence |
| DELETE | `/api/v1/chargebacks/:id/evidence/:evidenceId` | Remove an evidence item |
| POST | `/api/v1/chargebacks/:id/notes` | Attach an internal note |

### Register a chargeback

```http
POST /api/v1/chargebacks
Content-Type: application/json

{
  "merchantId": "merchant-1",
  "paymentId": "payment-1",
  "amount": 150.5,
  "currency": "USD",
  "reason": "fraudulent",
  "evidenceWindowDays": 7
}
```

### Submit evidence

```http
POST /api/v1/chargebacks/cb_<id>/evidence
Content-Type: application/json

{
  "type": "delivery_proof",
  "description": "Signed delivery receipt",
  "fileUrl": "https://example.com/receipt.pdf",
  "submittedBy": "merchant-1"
}
```

Every state change is appended to the case `timeline` for a full audit trail.
