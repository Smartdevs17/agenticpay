# Circuit Breaker for Downstream Providers (Issue #948)

Circuit breaker protection for all downstream payment providers (soroban,
evm, fiat, credit). Each provider is wrapped in an isolated circuit breaker so
a degraded or failing provider fails fast instead of exhausting timeouts and
retries, and failures in one provider cannot cascade to others (bulkhead
isolation).

## What changed

All four payment providers now guard their downstream calls with
`withCircuitBreaker` from `src/middleware/circuit-breaker.js`:

| Provider | Circuit name | Calls guarded |
|----------|-------------|---------------|
| `soroban` | `soroban-provider` | processPayment, refundPayment, getStatus |
| `evm` | `evm-provider` | processPayment, refundPayment, getStatus |
| `fiat` | `fiat-provider` | processPayment, refundPayment, getStatus |
| `credit` | `credit-provider` | processPayment, refundPayment, getStatus |

## File layout

```
backend/src/services/payments/providers/fiat.ts        # + withCircuitBreaker
backend/src/services/payments/providers/credit.ts      # + withCircuitBreaker
backend/src/services/payments/providers/soroban.ts     # already guarded
backend/src/services/payments/providers/evm.ts         # already guarded
backend/src/services/payments/providers/__tests__/circuit-breaker-integration.test.ts
backend/src/middleware/circuit-breaker.js              # existing facade
backend/src/services/circuitBreaker.ts                 # existing state machine
backend/docs/CIRCUIT_BREAKER.md                        # existing doc
backend/docs/CIRCUIT_BREAKER_PROVIDERS.md              # new
```

## How it works

Each provider method wraps its external call in `withCircuitBreaker(name, fn)`:

```ts
return fromThrowable(async () =>
  withCircuitBreaker(CIRCUIT_NAME, async () => {
    // downstream call (Stripe, Horizon, EVM RPC, ...)
  }),
);
```

Behavior:

- **Closed state** — calls flow to the downstream; outcomes (success/failure)
  are recorded in a sliding window.
- **Open state** — calls are short-circuited immediately with a
  `CircuitBreakerError` (fast-fail), protecting the downstream and the event
  loop.
- **Half-open state** — after `waitDurationInOpenState`, a bounded number of
  trial calls are allowed; enough consecutive successes return to closed.

Because each provider has its own named circuit, a flapping fiat feed cannot
trip the evm breaker.

## Usage

```ts
import { withCircuitBreaker } from '../../../middleware/circuit-breaker.js';

const result = await withCircuitBreaker('fiat-provider', () =>
  fiatPaymentsService.createPayment({ ... }),
);
```

When the breaker is open and no fallback is given, `withCircuitBreaker`
throws `CircuitBreakerError`. The payment router catches this and falls
through to the next provider.

## Observability

```ts
import { getCircuitState, getAllCircuits, resetCircuit } from '../../../middleware/circuit-breaker.js';

getCircuitState('fiat-provider');   // { state, metrics, ... }
getAllCircuits();                   // all provider circuits
resetCircuit('fiat-provider');      // force back to closed
```

Circuit state is also surfaced by `GET /api/v1/circuit-breaker`.

## Testing

```bash
cd backend
npx vitest run src/services/payments/providers/__tests__/circuit-breaker-integration.test.ts
npx vitest run src/middleware/__tests__/circuit-breaker.test.ts
```

## Failure paths covered

- Provider throws → failure recorded; consecutive failures trip the breaker.
- Breaker open → subsequent calls short-circuit with `CircuitBreakerError`.
- Provider succeeds → success recorded; breaker stays/closes to closed.
