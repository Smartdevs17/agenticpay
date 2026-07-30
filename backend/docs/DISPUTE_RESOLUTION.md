# Payment Dispute Resolution

Issue #641. Replaces informal ad-hoc dispute handling with a structured
workflow: open → respond → evidence → escalate / assign arbitrator →
resolve, with evidence integrity hashing, resolution records, dispute
notifications, and analytics.

- `backend/src/services/dispute-resolution/workflow-engine.ts` — pure,
  DB-free state machine (`canTransition`, `nextStatus`, SLA deadline
  helpers, auto-escalation rules).
- `backend/src/services/dispute-resolution/dispute-resolution-service.ts` —
  orchestration: create, respond, evidence CRUD, assign, escalate,
  resolve, timeline, notifications, analytics
  (`DisputeResolutionService`, singleton `disputeResolutionService`).
- `backend/src/services/dispute-resolution/index.ts` — public exports and
  the scheduled escalation entry point (`runScheduledDisputeEscalations`).
- `backend/src/routes/dispute-resolution.ts` — HTTP API
  (`disputeResolutionRouter`, mount path `/api/v1/dispute-resolution`).

## Structured workflow

Statuses (aligned with `@agenticpay/types` domain disputes):

```
pending → awaiting_response → under_review → resolved | dismissed
                 ↓                  ↓
            escalated  ←────────────┘
                 ↓
           under_review (after arbitrator assign) → resolved | dismissed
```

| Event | Effect |
| ----- | ------ |
| `submit` (on create) | Opens at `awaiting_response` with 72h response SLA and 168h escalation SLA |
| `respond` | Party message recorded; status → `under_review` |
| `add_evidence` | Evidence stored with SHA-256 hash; status unchanged (still non-terminal) |
| `escalate` | Status → `escalated` (manual or SLA cron) |
| `assign_arbitrator` | Sets `arbitratorId`; from `escalated` → `under_review` |
| `resolve` / `dismiss` | Terminal with outcome + resolution note |

Only one **active** (non-terminal) dispute is allowed per `paymentId`.

## Evidence management

`POST /disputes/:id/evidence` registers a file reference:

- Required: `submittedBy`, `fileUrl`, `fileName`, `fileType`, `fileSize`
- Optional: `description`, `contentBytes` (used for the hash when provided;
  otherwise a deterministic metadata string is hashed)
- Hash algorithm: **SHA-256** (hex), for tamper detection
- List: `GET /disputes/:id/evidence`
- Remove (open disputes only): `DELETE /disputes/:id/evidence/:evidenceId`

Binary upload itself uses the existing `POST /api/v1/file-upload` category
`dispute` (20MB). Callers then pass the returned URL into this evidence API.

## Resolution tracking

Resolving a dispute writes:

1. Dispute fields: `status`, `resolution`, `resolutionNote`, `refundAmount`,
   `resolvedAt`
2. An immutable `ResolutionRecord` (`outcome`, actor, role, note, refund)
3. A timeline event (`resolve` or `dismiss`)

Fetch history via `GET /disputes/:id/resolutions` and
`GET /disputes/:id/timeline`.

Outcomes: `full_refund` | `partial_refund` | `release_to_payee` |
`dismissed` | `pending`. Partial refunds require `refundAmount` in
`(0, dispute.amount]`. Full refund sets `refundAmount = amount`.

## Dispute notifications

Every meaningful transition emits channel fan-out notifications
(`email`, `push`, `in-app`) with templates:

| Template | When |
| -------- | ---- |
| `dispute_opened` | Respondent notified of new dispute |
| `dispute_opened_ack` | Filer acknowledgment |
| `dispute_response` | Counterparty notified of a response |
| `dispute_evidence` | Peers notified of new evidence |
| `dispute_assigned` | Arbitrator assignment |
| `dispute_escalated` | Both parties on escalation |
| `dispute_resolved` | Both parties on resolution |

Notifications are recorded on the dispute (inspectable via
`GET /disputes/:id/notifications`) and appear in the timeline as `notified`
events. They integrate with the existing preference keys
`disputeAlerts` / `disputeUpdates` and the `dispute_update` email template
when a production mailer is attached.

## Dispute analytics

`GET /api/v1/dispute-resolution/analytics?tenantId=` returns:

- Counts by status / reason / outcome
- Open / resolved / dismissed / escalated totals
- Average resolution hours
- Escalation rate (%)
- Total refunded amount
- Evidence + notification totals
- SLA breach count (open disputes past a deadline)

## API surface

Mounted at `/api/v1/dispute-resolution`:

```
POST   /disputes
GET    /disputes
GET    /disputes/:id
POST   /disputes/:id/respond
POST   /disputes/:id/evidence
GET    /disputes/:id/evidence
DELETE /disputes/:id/evidence/:evidenceId
POST   /disputes/:id/assign
POST   /disputes/:id/escalate
POST   /disputes/:id/resolve
GET    /disputes/:id/timeline
GET    /disputes/:id/resolutions
GET    /disputes/:id/notifications
GET    /analytics
POST   /escalations/process
```

### Create example

```bash
curl -sX POST http://localhost:3001/api/v1/dispute-resolution/disputes \
  -H 'content-type: application/json' \
  -d '{
    "tenantId": "ten_1",
    "paymentId": "pay_1",
    "filedBy": "user_payer",
    "respondentId": "user_payee",
    "reason": "service_not_delivered",
    "amount": 150,
    "currency": "USDC",
    "description": "Payment released but deliverable was never provided to the buyer."
  }'
```

## In-memory fallback

Like payment reconciliation, persistence is in-memory when `DATABASE_URL` is
unset so unit tests can exercise the full workflow without Postgres. Call
`disputeResolutionService.resetForTests()` between cases.

## Scheduled escalations

Register `runScheduledDisputeEscalations` (suggested cron `*/15 * * * *`)
or call `POST /escalations/process`. Auto-escalates:

- `awaiting_response` past `responseDeadline` (72h)
- `pending` / `under_review` past `escalationDeadline` (168h)

## Tests

```bash
cd backend && npm test -- src/services/__tests__/dispute-resolution.test.ts
```
