export type ChartPriority = 'critical' | 'deferrable';
export type ChartState = 'idle' | 'loading' | 'ready' | 'failed';

export interface ChartDefinition {
  id: string;
  label: string;
  priority: ChartPriority;
  estimatedBytes: number;
}

export interface ChartManifest {
  version: 1;
  initialBudgetBytes: number;
  charts: ChartDefinition[];
}

export interface ChartPlan {
  immediate: ChartDefinition[];
  deferred: ChartDefinition[];
  immediateBytes: number;
}

export type ChartErrorCode =
  | 'INVALID_MANIFEST'
  | 'BUDGET_EXCEEDED'
  | 'UNKNOWN_CHART'
  | 'CHUNK_LOAD_FAILED';

export class ChartRegistryError extends Error {
  readonly code: ChartErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ChartErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ChartRegistryError';
    this.code = code;
    this.details = details;
  }
}

export interface ChartLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface ChartMetrics {
  increment(name: string, labels?: Record<string, string | number>, value?: number): void;
  timing(name: string, ms: number, labels?: Record<string, string | number>): void;
}

export type ChartChunkLoader<T = unknown> = () => Promise<T>;

export interface LazyChartControllerOptions {
  manifest: ChartManifest;
  maxAttempts?: number;
  logger?: ChartLogger;
  metrics?: ChartMetrics;
  now?: () => number;
  traceId?: () => string;
}

interface ChartEntry<T = unknown> {
  state: ChartState;
  promise?: Promise<T>;
  value?: T;
  traceId?: string;
}

const noopLogger: ChartLogger = { info: () => {}, warn: () => {}, error: () => {} };
const noopMetrics: ChartMetrics = { increment: () => {}, timing: () => {} };

export function validateManifest(manifest: ChartManifest): void {
  if (
    !manifest
    || manifest.version !== 1
    || !Number.isFinite(manifest.initialBudgetBytes)
    || manifest.initialBudgetBytes <= 0
    || !Array.isArray(manifest.charts)
    || manifest.charts.length === 0
  ) {
    throw new ChartRegistryError('INVALID_MANIFEST', 'Manifest must be version 1 with a positive budget and charts');
  }
  const ids = new Set<string>();
  for (const chart of manifest.charts) {
    if (!chart || typeof chart.id !== 'string' || !/^[a-z0-9-]+$/.test(chart.id)) {
      throw new ChartRegistryError('INVALID_MANIFEST', 'Chart id must be a non-empty lowercase slug');
    }
    if (ids.has(chart.id)) {
      throw new ChartRegistryError('INVALID_MANIFEST', `Duplicate chart id: ${chart.id}`);
    }
    if (typeof chart.label !== 'string' || chart.label.length === 0) {
      throw new ChartRegistryError('INVALID_MANIFEST', `Chart ${chart.id} has no label`);
    }
    if (chart.priority !== 'critical' && chart.priority !== 'deferrable') {
      throw new ChartRegistryError('INVALID_MANIFEST', `Chart ${chart.id} has an invalid priority`);
    }
    if (!Number.isFinite(chart.estimatedBytes) || chart.estimatedBytes <= 0) {
      throw new ChartRegistryError('INVALID_MANIFEST', `Chart ${chart.id} has an invalid byte estimate`);
    }
    ids.add(chart.id);
  }
}

export function planCharts(manifest: ChartManifest): ChartPlan {
  validateManifest(manifest);
  const immediate = manifest.charts.filter((chart) => chart.priority === 'critical');
  const deferred = manifest.charts.filter((chart) => chart.priority === 'deferrable');
  const immediateBytes = immediate.reduce((total, chart) => total + chart.estimatedBytes, 0);
  if (immediateBytes > manifest.initialBudgetBytes) {
    throw new ChartRegistryError('BUDGET_EXCEEDED', 'Critical charts exceed the initial route budget', {
      immediateBytes,
      budgetBytes: manifest.initialBudgetBytes,
    });
  }
  return { immediate, deferred, immediateBytes };
}

export class LazyChartController {
  private readonly manifest: ChartManifest;
  private readonly maxAttempts: number;
  private readonly logger: ChartLogger;
  private readonly metrics: ChartMetrics;
  private readonly now: () => number;
  private readonly traceIdFactory: () => string;
  private readonly entries = new Map<string, ChartEntry>();

  constructor(options: LazyChartControllerOptions) {
    validateManifest(options.manifest);
    const maxAttempts = options.maxAttempts ?? 2;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new ChartRegistryError('INVALID_MANIFEST', 'maxAttempts must be a positive integer');
    }
    this.manifest = options.manifest;
    this.maxAttempts = maxAttempts;
    this.logger = options.logger ?? noopLogger;
    this.metrics = options.metrics ?? noopMetrics;
    this.now = options.now ?? (() => Date.now());
    let fallbackTrace = 0;
    this.traceIdFactory = options.traceId ?? (() => `chart-trace-${++fallbackTrace}`);
  }

  charts(): ChartDefinition[] {
    return this.manifest.charts.slice();
  }

  plan(): ChartPlan {
    return planCharts(this.manifest);
  }

  getState(id: string): ChartState {
    return this.entries.get(id)?.state ?? 'idle';
  }

  reset(id: string): void {
    this.entries.delete(id);
    this.logger.info('chart.load.reset', { id });
  }

  load<T>(id: string, loader: ChartChunkLoader<T>): Promise<T> {
    const chart = this.manifest.charts.find((item) => item.id === id);
    if (!chart) {
      return Promise.reject(new ChartRegistryError('UNKNOWN_CHART', `Unknown chart: ${id}`, { id }));
    }

    const existing = this.entries.get(id);
    if (existing?.state === 'ready') {
      this.logger.info('chart.load.cached', { id, traceId: existing.traceId });
      this.metrics.increment('chartLoadTotal', { id, outcome: 'cache', traceId: existing.traceId ?? '' });
      return Promise.resolve(existing.value as T);
    }
    if (existing?.promise) {
      this.logger.info('chart.load.deduped', { id, traceId: existing.traceId });
      this.metrics.increment('chartLoadTotal', { id, outcome: 'dedupe', traceId: existing.traceId ?? '' });
      return existing.promise as Promise<T>;
    }

    const traceId = this.traceIdFactory();
    const entry: ChartEntry<T> = { state: 'loading', traceId };
    this.entries.set(id, entry as ChartEntry);
    const started = this.now();
    const promise = this.run(chart, loader, traceId, started).then(
      (value) => {
        entry.state = 'ready';
        entry.value = value;
        entry.promise = undefined;
        return value;
      },
      (error: unknown) => {
        entry.state = 'failed';
        entry.value = undefined;
        entry.promise = undefined;
        throw error;
      },
    );
    entry.promise = promise;
    return promise;
  }

  reportRenderError(id: string, error: Error, info?: Record<string, unknown>): void {
    const traceId = this.entries.get(id)?.traceId ?? 'unknown';
    this.logger.error('chart.render.failed', {
      id,
      traceId,
      message: error.message,
      componentStack: info?.componentStack,
    });
    this.metrics.increment('chartRenderFailedTotal', { id, traceId });
  }

  private async run<T>(
    chart: ChartDefinition,
    loader: ChartChunkLoader<T>,
    traceId: string,
    started: number,
  ): Promise<T> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const value = await loader();
        const durationMs = this.now() - started;
        this.logger.info('chart.load.completed', {
          id: chart.id,
          traceId,
          attempt,
          bytes: chart.estimatedBytes,
          durationMs,
        });
        this.metrics.increment('chartLoadTotal', { id: chart.id, outcome: 'success', traceId }, 1);
        this.metrics.timing('chartLoadMs', durationMs, { id: chart.id, traceId });
        this.metrics.increment('chartChunkBytesTotal', { id: chart.id, traceId }, chart.estimatedBytes);
        return value;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt < this.maxAttempts) {
          this.logger.warn('chart.load.retry', { id: chart.id, traceId, attempt, reason });
          this.metrics.increment('chartRetryTotal', { id: chart.id, traceId, attempt }, 1);
          continue;
        }
        const durationMs = this.now() - started;
        this.logger.error('chart.load.failed', {
          id: chart.id,
          traceId,
          attempts: attempt,
          reason,
          durationMs,
        });
        this.metrics.increment('chartLoadTotal', { id: chart.id, outcome: 'failure', traceId }, 1);
        this.metrics.timing('chartLoadMs', durationMs, { id: chart.id, traceId });
        throw new ChartRegistryError('CHUNK_LOAD_FAILED', `Failed to load chart ${chart.id}`, {
          id: chart.id,
          traceId,
          attempts: attempt,
          reason,
        });
      }
    }
    throw new ChartRegistryError('CHUNK_LOAD_FAILED', `No load attempt made for chart ${chart.id}`, { id: chart.id });
  }
}

export function createLazyChartController(options: LazyChartControllerOptions): LazyChartController {
  return new LazyChartController(options);
}
