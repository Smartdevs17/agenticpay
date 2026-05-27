#258 Refactor: Implement Webhook Signature Verification

## Overview
Implement webhook signature verification for all incoming webhooks to prevent spoofed callbacks from payment providers, webhooks, and other services.

## Acceptance Criteria
- [ ] HMAC-SHA256 verification
- [ ] Per-provider secrets
- [ ] Timestamp verification (replay protection)
- [ ] Signature validation on all incoming
- [ ] Failed webhook queuing
- [ ] Manual retry
- [ ] Secret rotation
- [ ] Verification logs

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