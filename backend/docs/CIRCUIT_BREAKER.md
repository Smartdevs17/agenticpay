# Circuit Breaker for External Service Calls

A production-grade resilience pattern that protects the backend from cascading
failures when an external dependency (Stripe, Stellar/Horizon, an EVM/Soroban
RPC, a notification webhook, a Vault, etc.) degrades or goes down.

Two cooperating modules implement it:

- `src/services/circuitBreaker.ts` — a pure, self-contained state machine
  (`CircuitBreaker`) plus `src/services/circuitBreakerRegistry.ts` (a registry
  that owns named instances).
- `src/middleware/circuit-breaker.ts` — the backward-compatible facade used by
  existing callers: `withCircuitBreaker`, the Express `circuitBreaker` middleware,
  and the management helpers (`getCircuitState`, `getAllCircuits`, `resetCircuit`).

## Why / when to use

The default retry service (`services/retry`) already retries transient failures
with backoff, but it has **no shared, observable trip/open/recover lifecycle**.
A circuit breaker adds:

- **Fast-fail**: when a downstream is clearly unhealthy, reject immediately
  instead of burning timeouts/retries.
- **Bulkhead by name**: each logical service gets its own isolated breaker, so a
  flapping Stripe feed cannot trip the Horizon breaker (a security boundary).
- **Orderly recovery**: a bounded number of half-open probes, with enough
  consecutive successes returning the breaker to closed.
- **Observability**: serialisable snapshots + state-change events for metrics,
  alerting and the management API.

## State machine

```
               consecutive failures / failure-rate over sliding window
   closed ─────────────────────────────────────────────────────────────► open
     ▲                                                                      │
     │  successThreshold consecutive                                        │ waitDurationInOpenState
     │  successes in half_open                                              ▼
     └─────────────────────────────── half_open ◄───────────────────────────┘
                                       (bounded permitted calls; a single
                                        failure re-opens)
```

- **closed** — all calls pass. Outcomes are accumulated in a sliding window.
- **open** — calls are short-circuited (503 / `CircuitBreakerError`) until
  `waitDurationInOpenState` has elapsed since the breaker opened.
- **half_open** — at most `permittedNumberOfCallsInHalfOpenState` trial calls
  are allowed. `successThreshold` consecutive successes close the breaker; any
  failure re-opens it.

## Configuration

| Option | Default | Meaning |
| ------ | ------- | ------- |
| `slidingWindowSize` | 20 | Most-recent outcomes retained for the failure-rate window. |
| `minimumCallsToOpen` | 5 | Min window samples before the rate may trip the breaker. |
| `failureRateThreshold` | 50 | Failure rate (%) over the window that opens the breaker. |
| `failureThreshold` | 5 | Consecutive failures that open the breaker early. |
| `successThreshold` | 2 | Consecutive half-open successes that close the breaker. |
| `waitDurationInOpenState` | 60 000 | Time (ms) the breaker stays open before probing. |
| `permittedNumberOfCallsInHalfOpenState` | 3 | Half-open trial calls per window. |
| `requestTimeoutMs` | 10 000 | Per-call timeout (0 disables the guard, e.g. in tests). |
| `failClosed` | false | Policy lever; when true, closed still permits (see security). |
| `recordFailure` | — | Predicate; return false to observe but not count a failure. |
| `ignoreFailures` | — | Predicate; skip the outcome entirely. |

Per-call overrides are supported: `protect(fn, fallback, requestTimeoutMs)`.

## Usage

### Guard an async external call (preferred)

```ts
import { withCircuitBreaker } from '../middleware/circuit-breaker.js';

// backend/src/services/stripe.ts already does exactly this.
const intent = await withCircuitBreaker('stripe-api', () =>
  stripe.paymentIntents.create({ amount, currency }),
);
```

By default an open breaker **throws** `CircuitBreakerError`. Provide a `fallback`
to degrade gracefully instead:

```ts
const price = await withCircuitBreaker('fx-service', () => fetchFx(), () => cachedPrice);
```

### Guard an Express route

```ts
import { circuitBreaker } from '../middleware/circuit-breaker.js';

app.use('/rpc', circuitBreaker('evm-provider', { failureThreshold: 3 }));
```

When open, the route responds `503` with:

```json
{
  "error": {
    "code": "CIRCUIT_OPEN",
    "message": "Service evm-provider is temporarily unavailable. Circuit breaker is open.",
    "status": 503,
    "retryAfterMs": 12345
  }
}
```

### Direct, isolated instance

```ts
import { CircuitBreaker } from '../services/circuitBreaker.js';

const cb = new CircuitBreaker('vault', { failureThreshold: 5 });
const secret = await cb.protect(() => vault.readSecret(name), () => envFallback);
```

The clock is injectable (`new CircuitBreaker(name, config, now)`), enabling fully
deterministic tests of the open → half_open → closed cycle without real sleeps.

### Observability

```ts
import { getCircuitState, getAllCircuits, resetCircuit } from '../middleware/circuit-breaker.js';

getAllCircuits();            // serialisable snapshots (usable in res.json)
getCircuitState('stripe-api');
resetCircuit('stripe-api');  // force back to closed
```

Circuit state is surfaced by the existing management routes
`GET /api/v1/circuit-breaker` and `/api/v1/service-mesh/circuits`.

## Security considerations

- **Isolation / bulkhead**: every named circuit is an independent instance with
  its own window and thresholds, so one dependency's failure cannot open another
  service's breaker. Use one name per logical upstream.
- **Fail-closed policy**: `failClosed` is exposed so operators can require
  explicit admission for a given service rather than allowing by default.
- **Health-hint propagation**: an open breaker returns `retryAfterMs` and a
  503 so gateways/clients back off instead of hammering a degraded service.
- **No secrets in state**: snapshots contain only counters/timestamps/config —
  never credentials or payloads.
- **Orderly recovery**: half-open probes are bounded and must accumulate
  consecutive successes before re-closing, preventing a thundering-herd
  re-opening.

## Backward compatibility

The facade (`middleware/circuit-breaker.ts`) keeps the public surface unchanged:
`withCircuitBreaker`, `circuitBreaker`, `getCircuitState`, `getAllCircuits`,
`resetCircuit`, `CircuitBreakerError`. Existing consumers (`stripe.ts`,
`stellar.ts`, `transaction-monitor.ts`, `payments/providers/{evm,soroban}.ts`)
continue to work without modification, including the `instanceof
CircuitBreakerError` checks and name-based circuit registration.

## Testing

```bash
npx vitest run src/services/__tests__/circuitBreaker.test.ts            # state machine + registry (29)
npx vitest run src/middleware/__tests__/circuit-breaker.test.ts         # facade API (14)
npx vitest run src/middleware/__tests__/circuit-breaker.integration.test.ts  # real HTTP open/recover (5)
```

Coverage (v8, scoped via `--coverage.include` to `services/circuitBreaker.ts`,
`services/circuitBreakerRegistry.ts` and `middleware/circuit-breaker.ts`):
statements 97.5%, branches 87.7%, functions 98.1%, lines 98.2% — all above the
80% threshold.

## Performance

Per-request overhead is bounded to a constant-time permit check plus (on
completion) outcome accounting. Benchmarks (autocannon, see
`benchmarks/baseline.json`):

| Endpoint | Method | Throughput | p99 | Errors |
| -------- | ------ | ---------- | --- | ------ |
| `/api/v1/circuit-breaker` (closed) | GET | ~625 KB/s (≈7.0k rps) | 9 ms | 0 |
| `/api/v1/circuit-breaker/rejected` (open) | GET | ~750 KB/s (≈7.6k rps) | 8 ms | 0 |

The rejected path is intentionally the fast-fail 503 flow (all responses are
`non2xx` by design) and is the fastest route — showing that an open breaker adds
negligible overhead while protecting downstream resources.
