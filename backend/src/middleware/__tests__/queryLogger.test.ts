import { describe, expect, it, beforeEach, vi } from 'vitest';

const onSlowQueryMock = vi.fn();
const queryProfilerMock = {
  getStats: vi.fn().mockReturnValue({ total: 0, slow: 0 }),
  getTopSlowQueries: vi.fn().mockReturnValue([]),
  reset: vi.fn(),
};

const metricsMock = {
  increment: vi.fn(),
  distribution: vi.fn(),
};

vi.mock('@sentry/node', () => ({
  captureEvent: vi.fn(),
}));

vi.mock('../../config/database.js', () => ({
  SLOW_QUERY_THRESHOLD_MS: 100,
  VERY_SLOW_QUERY_THRESHOLD_MS: 2000,
  queryProfiler: queryProfilerMock,
  withQueryProfiling: vi.fn(),
  onSlowQuery: onSlowQueryMock,
  withQueryTimer: vi.fn(),
}));

vi.mock('../../observability/datadog.js', () => ({
  default: metricsMock,
}));

const {
  configureQueryLogger,
  getQueryMetrics,
  resetQueryMetrics,
  queryLoggerMiddleware,
  createPrismaQueryListener,
  getSlowQueryDashboard,
} = await import('../../middleware/queryLogger.js');

function makeRes() {
  const headers: Record<string, unknown> = {};
  const res: any = {
    getHeader: (name: string) => headers[name],
    setHeader: (name: string, value: unknown) => {
      headers[name] = value;
    },
    send: (body: unknown) => body,
  };
  return { res, headers };
}

describe('queryLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMetrics();
    configureQueryLogger({
      logAllQueries: false,
      slowThresholdMs: 100,
      criticalThresholdMs: 2000,
      alertCooldownMs: 300_000,
      emitMetrics: true,
    });
  });

  it('starts with empty metrics', () => {
    const metrics = getQueryMetrics();
    expect(metrics.totalQueries).toBe(0);
    expect(metrics.avgDurationMs).toBe(0);
    expect(metrics.slowPercentage).toBe(0);
  });

  it('records a slow query through the express middleware', () => {
    const { res, headers } = makeRes();
    headers['x-query-duration-ms'] = 250;
    const next = vi.fn();

    const middleware = queryLoggerMiddleware('test-source');
    middleware({ method: 'GET', path: '/api/v1/things' } as any, res, next);

    res.send({ ok: true });

    const metrics = getQueryMetrics();
    expect(metrics.totalQueries).toBe(1);
    expect(metrics.slowQueries).toBe(1);
    expect(metrics.avgDurationMs).toBe(250);
    expect(next).toHaveBeenCalled();
  });

  it('classifies a critical query and computes slow percentage', () => {
    const middleware = queryLoggerMiddleware('test-source');

    const first = makeRes();
    first.headers['x-query-duration-ms'] = 2500;
    middleware({ method: 'POST', path: '/api/v1/payments' } as any, first.res, vi.fn());
    first.res.send({});

    const second = makeRes();
    second.headers['x-query-duration-ms'] = 10;
    middleware({ method: 'GET', path: '/api/v1/fast' } as any, second.res, vi.fn());
    second.res.send({});

    const metrics = getQueryMetrics();
    expect(metrics.criticalQueries).toBe(1);
    expect(metrics.totalQueries).toBe(1);
    expect(metrics.totalDurationMs).toBe(2500);
  });

  it('ignores responses without a duration header', () => {
    const { res } = makeRes();
    const middleware = queryLoggerMiddleware('test-source');
    middleware({ method: 'GET', path: '/health' } as any, res, vi.fn());
    res.send({});
    expect(getQueryMetrics().totalQueries).toBe(0);
  });

  it('registers a slow query handler at import time', () => {
    expect(onSlowQueryMock).toHaveBeenCalledTimes(1);
    expect(typeof onSlowQueryMock.mock.calls[0][0]).toBe('function');
  });

  it('processes prisma query events and emits metrics', () => {
    const listener = createPrismaQueryListener();
    listener({
      timestamp: new Date(),
      query: 'SELECT * FROM payments WHERE id = $1',
      params: '["1"]',
      duration: 150,
      target: 'primary',
    });

    expect(getQueryMetrics().slowQueries).toBe(1);
    expect(metricsMock.distribution).toHaveBeenCalledWith(
      'db.query.duration',
      150,
      { target: 'primary' },
    );
  });

  it('tracks critical prisma queries separately', () => {
    const listener = createPrismaQueryListener();
    listener({
      timestamp: new Date(),
      query: 'SELECT * FROM audit_logs',
      params: '[]',
      duration: 5000,
      target: 'primary',
    });
    expect(getQueryMetrics().criticalQueries).toBe(1);
  });

  it('returns a slow query dashboard combining profiler and middleware data', () => {
    queryProfilerMock.getStats.mockReturnValue({ total: 3, slow: 1 });
    queryProfilerMock.getTopSlowQueries.mockReturnValue([
      { query: 'SELECT 1', durationMs: 500 },
    ]);
    const dashboard = getSlowQueryDashboard();
    expect(dashboard.profiler).toEqual({ total: 3, slow: 1 });
    expect(dashboard.slowThresholdMs).toBe(100);
    expect(dashboard.recentSlow[0].signature).toBeDefined();
  });
});
