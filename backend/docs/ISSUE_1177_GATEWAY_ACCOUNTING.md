# Gateway response accounting (#1177)

This increment corrects the health metrics and circuit breaker behavior in `BaseGatewayAdapter`.

- Returned payment responses with `success: false` or `status: failed` count as failures, even when the provider call does not throw.
- Repeated failed responses open the circuit at the configured threshold.
- A subsequent successful response resets the consecutive-failure count.
- The adapter retains its existing response contract rather than throwing for returned payment failures.

Run regression tests from `backend`:

```sh
npx vitest run src/integrations/__tests__/gateway-adapter-result.test.ts
```

The `GatewayManager` does not fail over for returned failed response objects; adjusting its retry/failover policy requires separate safeguards against ambiguous outcomes and duplicate charges.
