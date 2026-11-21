#!/usr/bin/env npx tsx
/**
 * Critical-path load test (#871).
 *
 * Exercises the payment-critical API paths with autocannon against the
 * self-contained benchmark app (no database, Stellar, or job scheduler) and
 * fails when latency or error budgets are breached.
 *
 * Usage:
 *   npm run load:critical
 *   LOAD_CONNECTIONS=50 LOAD_DURATION_SEC=15 npm run load:critical
 *
 * Environment:
 *   LOAD_PORT            port for the ephemeral benchmark server (default 3101)
 *   LOAD_CONNECTIONS     concurrent connections per endpoint (default 10)
 *   LOAD_DURATION_SEC    seconds per endpoint (default 10)
 *   LOAD_P99_BUDGET_MS   max allowed p99 latency in ms (default 500)
 *   LOAD_MAX_ERROR_RATE  max allowed errors+non2xx ratio 0..1 (default 0)
 */
import http from 'node:http';
import autocannon from 'autocannon';
import { createBenchmarkApp } from '../benchmarks/benchmark-app.js';

interface LoadEndpoint {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: string;
  headers?: Record<string, string>;
}

/** Critical payment paths — keep in sync with the API contract tests. */
const CRITICAL_ENDPOINTS: LoadEndpoint[] = [
  { name: 'health', method: 'GET', path: '/health' },
  { name: 'escrow_list', method: 'GET', path: '/api/v1/escrow' },
  {
    name: 'escrow_create',
    method: 'POST',
    path: '/api/v1/escrow',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: 'load-proj',
      payerId: 'payer-load',
      payeeId: 'payee-load',
      currency: 'USD',
      totalAmount: 1000,
      milestones: [{ title: 'Load milestone', amount: 1000, completionCriteria: 'ok' }],
    }),
  },
  {
    name: 'sandbox_payment_process',
    method: 'POST',
    path: '/api/v1/sandbox/payments/process',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: 'load-proj',
      clientAddress: 'GCLIENT000000000000000000000000000000000000000',
      freelancerAddress: 'GFREEL00000000000000000000000000000000000000',
      amount: 100,
      currency: 'XLM',
    }),
  },
  { name: 'flags', method: 'GET', path: '/api/v1/flags' },
];

const PORT = Number(process.env.LOAD_PORT ?? 3101);
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? 10);
const DURATION = Number(process.env.LOAD_DURATION_SEC ?? 10);
const P99_BUDGET_MS = Number(process.env.LOAD_P99_BUDGET_MS ?? 500);
const MAX_ERROR_RATE = Number(process.env.LOAD_MAX_ERROR_RATE ?? 0);

interface EndpointVerdict {
  name: string;
  requests: number;
  throughput: number;
  p99: number;
  errorRate: number;
  pass: boolean;
  reason?: string;
}

function runLoad(url: string, endpoint: LoadEndpoint): Promise<autocannon.Result> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        method: endpoint.method,
        body: endpoint.body,
        headers: endpoint.headers,
        connections: CONNECTIONS,
        duration: DURATION,
        pipelining: 1,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
    autocannon.track(instance, { renderProgressBar: false });
  });
}

async function waitForServer(url: string, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 503) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Load-test server did not become ready at ${url}`);
}

async function main(): Promise<void> {
  const app = createBenchmarkApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  console.log(
    `Critical-path load test: ${CONNECTIONS} connections x ${DURATION}s per endpoint (p99 budget ${P99_BUDGET_MS}ms, max error rate ${MAX_ERROR_RATE})\n`
  );

  const verdicts: EndpointVerdict[] = [];
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/health`);

    for (const endpoint of CRITICAL_ENDPOINTS) {
      process.stdout.write(`  ${endpoint.name} (${endpoint.method} ${endpoint.path})... `);
      const result = await runLoad(`http://127.0.0.1:${PORT}${endpoint.path}`, endpoint);
      const total = result.requests.total || 1;
      const errorRate = (result.errors + result.non2xx) / total;
      const p99 = result.latency.p99;

      let reason: string | undefined;
      if (p99 > P99_BUDGET_MS) reason = `p99 ${p99.toFixed(2)}ms exceeds budget ${P99_BUDGET_MS}ms`;
      else if (errorRate > MAX_ERROR_RATE) reason = `error rate ${(errorRate * 100).toFixed(2)}% exceeds budget ${MAX_ERROR_RATE * 100}%`;

      verdicts.push({
        name: endpoint.name,
        requests: result.requests.total,
        throughput: result.throughput.average,
        p99,
        errorRate,
        pass: reason === undefined,
        reason,
      });
      console.log(
        reason ?? `ok (p99=${p99.toFixed(2)}ms, ${result.throughput.average.toFixed(0)} req/s)`
      );
    }
  } finally {
    // Autocannon reuses keep-alive connections: destroy them first or the
    // process would linger with open sockets after the run.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const failures = verdicts.filter((v) => !v.pass);
  console.log('\n| Endpoint | Requests | Throughput | p99 | Error rate | Result |');
  console.log('|----------|----------|------------|-----|------------|--------|');
  for (const v of verdicts) {
    console.log(
      `| ${v.name} | ${v.requests} | ${v.throughput.toFixed(0)} req/s | ${v.p99.toFixed(2)}ms | ${(v.errorRate * 100).toFixed(2)}% | ${v.pass ? 'pass' : `FAIL (${v.reason})`} |`
    );
  }

  if (failures.length > 0) {
    console.error(`\nLoad test FAILED: ${failures.length}/${verdicts.length} critical paths breached budget.`);
    process.exit(1);
  }
  console.log('\nLoad test PASSED: all critical paths within budget.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
