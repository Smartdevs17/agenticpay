# Developer portal chart Suspense boundaries

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
