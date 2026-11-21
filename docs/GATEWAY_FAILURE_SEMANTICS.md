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

Do not automatically replay a payment against another provider after a provider
or transport error: the provider may already have processed the request even if its
response was lost. The gateway manager only falls back automatically when an adapter
rejects before calling its provider because its circuit is open. Other errors are
returned to the caller for reconciliation. If an application adds retry after an
ambiguous outcome, it must first reconcile the original transaction or use a provider
contract that guarantees cross-gateway deduplication. Keep the same payment identifier
and idempotency key across safe retries.

## Verification

From `backend/`, run:

```bash
npm test -- src/integrations/gateway-adapter.test.ts
npm run build
```
