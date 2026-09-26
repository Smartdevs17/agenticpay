/**
 * Top 10 API endpoints for performance benchmarking.
 * Paths are relative to the server root (health) or /api/v1 prefix.
 */

export interface BenchmarkEndpoint {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: string;
  headers?: Record<string, string>;
}

export const BENCHMARK_ENDPOINTS: BenchmarkEndpoint[] = [
  { name: 'health', method: 'GET', path: '/health' },
  { name: 'ready', method: 'GET', path: '/ready' },
  { name: 'sandbox_status', method: 'GET', path: '/api/v1/sandbox/status' },
  { name: 'escrow_list', method: 'GET', path: '/api/v1/escrow' },
  { name: 'flags', method: 'GET', path: '/api/v1/flags' },
  { name: 'compression_metrics', method: 'GET', path: '/api/v1/compression/metrics' },
  { name: 'pool_metrics', method: 'GET', path: '/api/v1/pool/metrics' },
  {
    name: 'sandbox_payment_process',
    method: 'POST',
    path: '/api/v1/sandbox/payments/process',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: 'bench-proj',
      clientAddress: 'GCLIENT000000000000000000000000000000000000000',
      freelancerAddress: 'GFREEL00000000000000000000000000000000000000',
      amount: 100,
      currency: 'XLM',
    }),
  },
  {
    name: 'escrow_create',
    method: 'POST',
    path: '/api/v1/escrow',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: 'bench-proj-2',
      payerId: 'payer-1',
      payeeId: 'payee-1',
      currency: 'USD',
      totalAmount: 1000,
      milestones: [
        {
          title: 'Milestone 1',
          amount: 1000,
          completionCriteria: 'Deliverable accepted',
        },
      ],
    }),
  },
  { name: 'circuit_breaker', method: 'GET', path: '/api/v1/circuit-breaker' },
];

export const DEFAULT_BENCHMARK_OPTIONS = {
  connections: Number(process.env.BENCHMARK_CONNECTIONS ?? 10),
  duration: Number(process.env.BENCHMARK_DURATION_SEC ?? 3),
  pipelining: 1,
  warmup: { duration: Number(process.env.BENCHMARK_WARMUP_SEC ?? 1) },
};

/** Regression threshold — fail CI if p99 latency exceeds baseline by this ratio */
export const REGRESSION_THRESHOLD = 0.1;
