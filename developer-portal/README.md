# AgenticPay Developer Portal

Internal Next.js console for operators. The admin surface is protected by a base
operator session **plus** a fresh WebAuthn step-up assertion.

## Configuration

| Variable | Purpose |
| --- | --- |
| `WEBAUTHN_RP_ID` | Relying-party id (required) |
| `WEBAUTHN_ORIGIN` | Full ceremony origin, including scheme (required) |
| `WEBAUTHN_RP_NAME` | Browser prompt name (optional) |
| `WEBAUTHN_CHALLENGE_TTL_MS` | Challenge lifetime (default 60s) |
| `WEBAUTHN_STEP_UP_TTL_MS` | Step-up session lifetime (default 5m) |
| `WEBAUTHN_USER_VERIFICATION` | `required` (default), `preferred` or `discouraged` |
| `WEBAUTHN_STATE_DIR` | Directory for the durable credential file (default `.data`) |

The portal fails closed when either required variable is missing.

## Typed server actions

Client components call the actions in `app/actions/index.ts` directly instead of
hand-building JSON posts. Every action returns a serialisable result:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionErrorCode; message: string };
```

| Action | Purpose |
| --- | --- |
| `startStepUpAction()` | Begin an assertion (requires the base session) |
| `finishStepUpAction(response)` | Verify the assertion and set the HttpOnly step-up cookie |
| `startEnrollAction()` | Begin registration; a second passkey requires step-up |
| `finishEnrollAction(response)` | Verify the attestation and persist the credential |

All untrusted payloads are parsed by the Zod schemas in `lib/schemas.ts` before
they reach the WebAuthn service. Validation, authentication, ceremony handling
and audit events live in `app/actions/core.ts`; the server actions and the
`app/admin/api/**` route handlers are thin adapters over that same core, so a
browser and a REST client cannot diverge in behaviour.

Errors use stable codes: `ADMIN_AUTH_REQUIRED`, `STEP_UP_REQUIRED`,
`INVALID_INPUT`, `NO_CREDENTIALS`, `CHALLENGE_INVALID`, `CREDENTIAL_UNKNOWN`,
`VERIFICATION_FAILED`, `COUNTER_REPLAYED` and `INTERNAL_ERROR`. The HTTP adapters
map these to 401/403/400/500 respectively.

## Observability

Every gate decision and ceremony outcome emits a structured JSON event through
`createSecurityEvents` (`admin.access_granted`, `admin.access_denied`,
`webauthn.*`), including `x-trace-id` / `x-request-id` correlation when present.
Rejected inputs are recorded with `reason: INVALID_INPUT`. Counters are available
via `events.snapshot()`.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run lint
```
## Chart Suspense boundaries

Issue #1641: the developer portal's chart bundles were imported into the first
route render, so one slow chart chunk delayed the whole page. Charts now sit
behind `Suspense` boundaries with an explicit immediate/deferred plan,
deduplicated chunk loads and observable failures.

## What ships

- `app/charts/manifest.json` — the only source of truth for chart ids, labels,
  priority and estimated chunk bytes. Critical charts stay under the 128 KB
  initial-route budget; larger deferrable charts mount only when the portal
  reveals them.
- `app/charts/lazy-chart-registry.ts` — a framework-agnostic planner and load
  controller. It validates the manifest, plans the two groups, deduplicates
  concurrent and repeat loads, retries transient failures and emits logs,
  metrics and trace ids through injected hooks.
- `components/LazyChart.tsx` — the React boundary: `React.lazy` inside
  `Suspense`, an accessible loading skeleton, and a retryable error boundary.
  It has no static charting-library import and no direct chart-module import.

## Planning

`planCharts(manifest)` returns `{ immediate, deferred, immediateBytes }`.
`critical` charts go into `immediate`, `deferrable` charts into `deferred`, and
the total for `immediate` must not exceed `initialBudgetBytes`. A bad manifest
or an over-budget critical group fails loudly with `ChartRegistryError`
(`INVALID_MANIFEST` / `BUDGET_EXCEEDED`) instead of silently dropping a chart.

## Controller API

`createLazyChartController(options)` / `LazyChartController` expose:

- `plan()` and `charts()` for the route to decide what to mount.
- `load(id, importer)` — resolves a chunk module once. Repeat calls after
  success return the cached module; concurrent calls before resolution share
  the same promise.
- `getState(id)` — `idle`, `loading`, `ready` or `failed`.
- `reset(id)` — clears a failed chunk so a user retry starts a fresh cycle.
- `reportRenderError(id, error, info)` — records failures thrown while the
  loaded component renders, not just while its chunk downloads.

Options: `manifest`, `maxAttempts` (default 2), injected `logger`, `metrics`,
`now` and `traceId`. Unknown ids reject with `UNKNOWN_CHART` before any
importer runs.

## Failure behavior and observability

The first failed import is retried once and logged as `chart.load.retry` with
an attempt number. A terminal failure sets the chart to `failed`, logs
`chart.load.failed` with the reason and duration, and rejects with
`CHUNK_LOAD_FAILED` carrying `{ id, traceId, attempts, reason }`. No success
metric is recorded for a failed chart. A render failure logs
`chart.render.failed` and increments `chartRenderFailedTotal`.

Successful loads log `chart.load.completed` with id, attempt, estimated bytes,
duration and trace id; cache and dedupe hits log `chart.load.cached` and
`chart.load.deduped`. Metrics are `chartLoadTotal` (labelled by outcome
`success`/`cache`/`dedupe`/`failure`), `chartLoadMs`, `chartChunkBytesTotal`,
`chartRetryTotal` and `chartRenderFailedTotal`. Every event and metric carries
the trace id for correlation.

## Integration

Build one controller per portal session and pass it to every boundary:

```tsx
const controller = createLazyChartController({ manifest, logger, metrics });
const { immediate, deferred } = controller.plan();

{[...immediate, ...deferred].map((chart) => (
  <LazyChart
    key={chart.id}
    chart={chart}
    controller={controller}
    load={chartLoaders[chart.id]}
  />
))}
```

`chartLoaders` is a route-owned map of `id` to `() => import(...)`, so the
boundary module never names a concrete chart. Mount `deferred` charts after an
intersection or idle callback rather than at first paint. Give each boundary a
stable `key` so React keeps the chunk cache, and let the boundary's retry
button call `controller.reset(id)` before remounting.

## Compatibility and configuration

The registry has no framework dependency, so the portal route can supply any
importer. Adding a chart means adding one manifest entry plus its loader in the
route; no registry changes are needed. Raising `initialBudgetBytes` opts more
critical charts into the initial group, while `maxAttempts` controls retry
budget.

## Validation

`node --experimental-strip-types --test developer-portal/app/charts/lazy-chart-registry.test.ts`
— 14 tests covering manifest validation, budget planning, cache/dedupe,
timing and byte metrics, retry, terminal failure and reset, render errors,
and source guards that keep heavyweight charts out of the boundary module.
