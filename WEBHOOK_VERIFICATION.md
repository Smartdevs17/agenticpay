#258 Refactor: Implement Webhook Signature Verification

## Overview
Implement webhook signature verification for all incoming webhooks to prevent spoofed callbacks from payment providers, webhooks, and other services.

## Acceptance Criteria
- [x] HMAC-SHA256 verification
- [x] Per-provider secrets (with optional `keyId` for rotation)
- [x] Timestamp verification (replay protection) + event-id dedup
- [x] Signature validation on all incoming (`/webhooks/*`, Stripe SDK on `/webhooks/stripe`)
- [x] Failed webhook queuing
- [x] Manual retry
- [x] Secret rotation
- [x] Verification logs (structured Pino + `/api/v1/webhooks/audit`)

## Technical Scope
- Files: backend/webhooks/verification
- Edge Cases: Clock skew, algorithm mismatch

## Complexity Estimate
200 points - Verification, secure storage.

## Key Rotation: Overlap, Retention, and Replay Tolerance

`WebhookKeyRegistry` (`backend/src/services/webhookKeys.ts`) governs how long a
rotated secret keeps working and how it is retired. Get these windows wrong
and either genuine events get rejected mid-rotation, or revoked secrets keep
verifying signatures long after they should not.

- **`overlapSeconds`** (default `DEFAULT_OVERLAP_SECONDS` = 72h) — passed to
  `registry.rotate({ overlapSeconds })`. For this long after a secret is
  rotated, the *previous* secret still verifies signatures alongside the new
  one. Set this to at least as long as the slowest provider takes to pick up
  a newly configured secret (e.g. Stripe can take a while to fully cut over
  after a dashboard change) — too short, and in-flight webhooks signed with
  the old secret start failing verification before the provider has switched.
- **`retentionSeconds`** (default `DEFAULT_RETENTION_SECONDS` = 7 days) — how
  long an expired or revoked key is kept around (rather than purged) so that
  verification attempts against it can still be logged and classified by
  reason, instead of just vanishing. This is operational/audit retention, not
  a security control — a key past its `overlapSeconds` window no longer
  verifies anything regardless of retention.
- **`toleranceSeconds`** (default `DEFAULT_TOLERANCE_SECONDS` = 300) — the
  replay-protection clock-skew window: a webhook's timestamp must be within
  this many seconds of `registry` time, in either direction, or verification
  rejects it as expired/replayed. Widen this only to accommodate real clock
  drift between you and the provider, since every second added is a second a
  captured signature + body could be replayed.

All three are constructor options on `WebhookKeyRegistry` (`new
WebhookKeyRegistry({ overlapSeconds, retentionSeconds, toleranceSeconds })`)
and default to the constants above when omitted.

## Implementation Plan
1. Create webhook verification service with HMAC-SHA256
2. Implement per-provider secret management
3. Add timestamp verification for replay protection
4. Create webhook verification middleware
5. Implement failed webhook queuing system
6. Add manual retry functionality
7. Create secret rotation mechanism
8. Add comprehensive verification logging
9. Update webhook routes to use verification
10. Create admin interface for webhook management

## Replay window and signature comparison

- A timestamp that does not parse as a date is rejected with `Timestamp is not a valid date`. An invalid date yields `NaN` in the tolerance check, and `NaN > tolerance` is false, so it previously passed the replay window.
- Digests are compared with `crypto.timingSafeEqual` over the decoded bytes. A non-hex or wrong-length signature fails closed without throwing.
