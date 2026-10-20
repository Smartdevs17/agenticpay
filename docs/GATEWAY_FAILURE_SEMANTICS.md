# Gateway failure and circuit-breaker semantics

This note documents the behavior expected from the shared gateway adapter.

## Payment outcomes are not transport outcomes

A provider call can resolve at the HTTP/SDK layer while reporting a declined or
failed payment. The adapter must record a failure whenever `success` is false
or `status` is `failed`; it must not increase the success rate merely because
the provider call resolved. The original response is returned so callers retain
the provider's transaction identifier and error details.

## Circuit-breaker recovery

After the failure threshold is reached, the gateway circuit opens. Once the
cooldown expires, one request may act as a half-open probe. A successful probe
closes the circuit and resets consecutive failures. A failed response or thrown
error during that probe reopens the circuit immediately; it must not remain
half-open until another threshold is reached.

## Safe fallback and idempotency

Do not automatically replay a payment against another provider solely because
the response is a definitive decline/failure: the provider may already have
processed the request. Failover after ambiguous transport errors requires a
shared idempotency key or reconciliation that can establish the original
outcome. Keep the same payment identifier and idempotency key across safe
retries.

## Verification

From `backend/`, run:

```bash
npm test -- src/integrations/gateway-adapter.test.ts
npm run build
```
