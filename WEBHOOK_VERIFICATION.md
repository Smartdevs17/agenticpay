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