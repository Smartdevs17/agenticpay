import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  ChartRegistryError,
  createLazyChartController,
  planCharts,
  validateManifest,
  type ChartLogger,
  type ChartManifest,
  type ChartMetrics,
  type LazyChartControllerOptions,
} from './lazy-chart-registry.ts';

const manifest = JSON.parse(
  readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'),
) as ChartManifest;

interface RecordedMetric {
  name: string;
  labels?: Record<string, string | number>;
  value?: number;
  ms?: number;
}

function harness(overrides: Partial<LazyChartControllerOptions> = {}) {
  const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  const metrics: RecordedMetric[] = [];
  let clock = 0;
  let trace = 0;
  const logger: ChartLogger = {
    info: (event, fields) => events.push({ event, fields }),
    warn: (event, fields) => events.push({ event, fields }),
    error: (event, fields) => events.push({ event, fields }),
  };
  const meter: ChartMetrics = {
    increment: (name, labels, value) => metrics.push({ name, labels, value }),
    timing: (name, ms, labels) => metrics.push({ name, ms, labels }),
  };
  const controller = createLazyChartController({
    manifest,
    logger,
    metrics: meter,
    now: () => clock,
    traceId: () => `trace-${++trace}`,
    ...overrides,
  });
  return {
    controller,
    events,
    metrics,
    advance: (ms: number) => { clock += ms; },
  };
}

const module = async () => ({ default: 'rendered-chart' });

describe('developer portal chart manifest', () => {
  it('ships a valid registry of critical and deferrable charts', () => {
    validateManifest(manifest);
    assert.deepEqual(manifest.charts.map((chart) => chart.id), [
      'api-volume',
      'error-rate',
      'latency-breakdown',
      'network-mix',
    ]);
  });

  it('rejects malformed entries explicitly', () => {
    const duplicate = { ...manifest, charts: [manifest.charts[0], manifest.charts[0]] } as ChartManifest;
    assert.throws(
      () => validateManifest(duplicate),
      (error: unknown) => error instanceof ChartRegistryError && error.code === 'INVALID_MANIFEST',
    );

    const badPriority = {
      ...manifest,
      charts: [{ ...manifest.charts[0], priority: 'later' }, ...manifest.charts.slice(1)],
    } as ChartManifest;
    assert.throws(
      () => validateManifest(badPriority),
      (error: unknown) => error instanceof ChartRegistryError && error.code === 'INVALID_MANIFEST',
    );

    const badBytes = {
      ...manifest,
      charts: [{ ...manifest.charts[0], estimatedBytes: 0 }, ...manifest.charts.slice(1)],
    } as ChartManifest;
    assert.throws(
      () => validateManifest(badBytes),
      (error: unknown) => error instanceof ChartRegistryError && error.code === 'INVALID_MANIFEST',
    );
  });

  it('plans immediate and deferred charts within the route budget', () => {
    const plan = planCharts(manifest);
    assert.deepEqual(plan.immediate.map((chart) => chart.id), ['api-volume', 'error-rate']);
    assert.deepEqual(plan.deferred.map((chart) => chart.id), ['latency-breakdown', 'network-mix']);
    assert.equal(plan.immediateBytes, 120000);
    assert.ok(plan.immediateBytes <= manifest.initialBudgetBytes);
  });

  it('refuses to exceed the initial route budget', () => {
    assert.throws(
      () => planCharts({ ...manifest, initialBudgetBytes: 1000 }),
      (error: unknown) => error instanceof ChartRegistryError && error.code === 'BUDGET_EXCEEDED',
    );
  });
});

describe('lazy chart controller', () => {
  it('loads a chunk once, records timing and bytes, and correlates logs with a trace id', async () => {
    const h = harness();
    const loaded = await h.controller.load('api-volume', async () => {
      h.advance(12);
      return module();
    });

    assert.deepEqual(loaded, { default: 'rendered-chart' });
    assert.equal(h.controller.getState('api-volume'), 'ready');
    assert.ok(h.events.some((entry) => entry.event === 'chart.load.completed'
      && entry.fields?.traceId === 'trace-1'
      && entry.fields?.durationMs === 12
      && entry.fields?.bytes === 62000));
    assert.ok(h.metrics.some((entry) => entry.name === 'chartLoadTotal' && entry.labels?.outcome === 'success'));
    assert.ok(h.metrics.some((entry) => entry.name === 'chartLoadMs' && entry.ms === 12));
    assert.ok(h.metrics.some((entry) => entry.name === 'chartChunkBytesTotal' && entry.value === 62000));
  });

  it('serves subsequent loads from cache without re-running the importer', async () => {
    const h = harness();
    let calls = 0;
    const loader = async () => { calls += 1; return module(); };

    await h.controller.load('error-rate', loader);
    const cached = await h.controller.load('error-rate', loader);

    assert.equal(calls, 1);
    assert.deepEqual(cached, { default: 'rendered-chart' });
    assert.ok(h.events.some((entry) => entry.event === 'chart.load.cached'));
    assert.ok(h.metrics.some((entry) => entry.name === 'chartLoadTotal' && entry.labels?.outcome === 'cache'));
  });

  it('deduplicates concurrent requests into a single importer call', async () => {
    const h = harness();
    let resolveImport: (value: { default: string }) => void = () => {};
    let calls = 0;
    const loader = () => {
      calls += 1;
      return new Promise<{ default: string }>((resolve) => { resolveImport = resolve; });
    };

    const first = h.controller.load('api-volume', loader);
    const second = h.controller.load('api-volume', loader);
    assert.equal(first, second);
    resolveImport({ default: 'rendered-chart' });

    assert.deepEqual(await first, { default: 'rendered-chart' });
    assert.equal(calls, 1);
    assert.ok(h.events.some((entry) => entry.event === 'chart.load.deduped'));
    assert.ok(h.metrics.some((entry) => entry.name === 'chartLoadTotal' && entry.labels?.outcome === 'dedupe'));
  });

  it('retries a failed import once and then succeeds', async () => {
    const h = harness();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      if (calls === 1) throw new Error('network glitch');
      return module();
    };

    const loaded = await h.controller.load('latency-breakdown', loader);

    assert.equal(calls, 2);
    assert.deepEqual(loaded, { default: 'rendered-chart' });
    assert.equal(h.controller.getState('latency-breakdown'), 'ready');
    assert.ok(h.events.some((entry) => entry.event === 'chart.load.retry' && entry.fields?.attempt === 1));
    assert.ok(h.metrics.some((entry) => entry.name === 'chartRetryTotal' && entry.labels?.attempt === 1));
  });

  it('fails actionably after the last attempt and can be reset for a user retry', async () => {
    const h = harness();
    let calls = 0;
    const loader = async () => { calls += 1; throw new Error('chunk unavailable'); };

    await assert.rejects(
      () => h.controller.load('network-mix', loader),
      (error: unknown) => error instanceof ChartRegistryError
        && error.code === 'CHUNK_LOAD_FAILED'
        && error.details.id === 'network-mix'
        && error.details.attempts === 2,
    );
    assert.equal(calls, 2);
    assert.equal(h.controller.getState('network-mix'), 'failed');
    assert.ok(!h.metrics.some((entry) => entry.name === 'chartLoadTotal' && entry.labels?.outcome === 'success'));
    assert.ok(h.metrics.some((entry) => entry.name === 'chartLoadTotal' && entry.labels?.outcome === 'failure'));
    assert.ok(h.events.some((entry) => entry.event === 'chart.load.failed' && entry.fields?.reason === 'chunk unavailable'));

    h.controller.reset('network-mix');
    assert.equal(h.controller.getState('network-mix'), 'idle');
    assert.ok(h.events.some((entry) => entry.event === 'chart.load.reset'));
    assert.deepEqual(await h.controller.load('network-mix', module), { default: 'rendered-chart' });
  });

  it('rejects unknown chart ids without calling an importer', async () => {
    const h = harness();
    let called = false;
    await assert.rejects(
      () => h.controller.load('does-not-exist', async () => { called = true; return module(); }),
      (error: unknown) => error instanceof ChartRegistryError && error.code === 'UNKNOWN_CHART',
    );
    assert.equal(called, false);
  });

  it('reports render failures from the visible Suspense boundary', () => {
    const h = harness();
    h.controller.reportRenderError('api-volume', new Error('render crashed'), { componentStack: 'Chart' });

    assert.ok(h.events.some((entry) => entry.event === 'chart.render.failed'
      && entry.fields?.id === 'api-volume'
      && entry.fields?.traceId === 'unknown'));
    assert.ok(h.metrics.some((entry) => entry.name === 'chartRenderFailedTotal'));
  });
});

describe('Suspense boundary source guard', () => {
  const source = readFileSync(new URL('../../components/LazyChart.tsx', import.meta.url), 'utf8');

  it('wraps the lazy chunk in Suspense with an accessible skeleton', () => {
    assert.match(source, /<Suspense\s+fallback=\{<ChartSkeleton/);
    assert.match(source, /role="status"/);
    assert.match(source, /aria-busy="true"/);
  });

  it('provides a retryable error boundary for failed chunks', () => {
    assert.match(source, /class ChartErrorBoundary/);
    assert.match(source, /getDerivedStateFromError/);
    assert.match(source, /Retry chart/);
    assert.match(source, /controller\.reset\(/);
  });

  it('never statically imports a charting library or a heavyweight chart module', () => {
    assert.equal(/from\s+['"]recharts['"]/.test(source), false);
    assert.equal(/import\s+.*DashboardCharts/.test(source), false);
    assert.match(source, /React\.lazy\(\(\) => controller\.load\(/);
  });
});
