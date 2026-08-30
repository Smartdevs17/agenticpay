/**
 * Top 10 API endpoints for performance benchmarking.
 * Paths are relative to the server root (health) or /api/v1 prefix.
 */

export interface BenchmarkEndpoint {
  name: string;
  method: 'GET' | 'POST' | 'OPTIONS';
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
  {
    name: 'cache_plain',
    method: 'GET',
    path: '/api/v1/cache/plain',
  },
  {
    name: 'cache_header_only',
    method: 'GET',
    path: '/api/v1/cache/header',
  },
  {
    name: 'cache_memory_hit',
    method: 'GET',
    path: '/api/v1/cache/memory',
  },
  {
    name: 'cache_etag_304',
    method: 'GET',
    path: '/api/v1/cache/etag-304',
    headers: { 'if-none-match': '*' },
  },
  {
    name: 'cors_allowed',
    method: 'GET',
    path: '/api/v1/cors/allowed',
    headers: { origin: 'https://app.example.com' },
  },
  {
    name: 'cors_wildcard',
    method: 'GET',
    path: '/api/v1/cors/allowed',
    headers: { origin: 'https://app.tenant.example.com' },
  },
  {
    name: 'cors_preflight',
    method: 'OPTIONS',
    path: '/api/v1/cors/allowed',
    headers: {
      origin: 'https://app.example.com',
      'access-control-request-method': 'GET',
    },
  },
  {
    name: 'webhook_verify_valid',
    method: 'POST',
    path: '/api/v1/webhook/verify',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'bench.webhook', data: { id: 'bench_w_1' } }),
  },
  {
    name: 'webhook_verify_invalid',
    method: 'POST',
    path: '/api/v1/webhook/verify-invalid',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'bench.webhook', data: { id: 'bench_w_2' } }),
  },
];

export const DEFAULT_BENCHMARK_OPTIONS = {
  connections: Number(process.env.BENCHMARK_CONNECTIONS ?? 10),
  duration: Number(process.env.BENCHMARK_DURATION_SEC ?? 3),
  pipelining: 1,
  warmup: { duration: Number(process.env.BENCHMARK_WARMUP_SEC ?? 1) },
};

/** Regression threshold — fail CI if p99 latency exceeds baseline by this ratio */
export const REGRESSION_THRESHOLD = 0.1;
