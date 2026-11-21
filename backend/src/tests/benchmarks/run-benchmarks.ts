#!/usr/bin/env npx tsx
/**
 * API benchmark runner using autocannon.
 * Usage:
 *   npm run benchmark
 *   npm run benchmark:baseline   # writes benchmarks/baseline.json
 */

import autocannon from 'autocannon';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  BENCHMARK_ENDPOINTS,
  DEFAULT_BENCHMARK_OPTIONS,
} from './endpoints.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const RESULTS_DIR = path.join(BACKEND_ROOT, 'benchmarks');
const BASELINE_PATH = path.join(RESULTS_DIR, 'baseline.json');
const RESULTS_PATH = path.join(RESULTS_DIR, 'results.json');

const PORT = Number(process.env.BENCHMARK_PORT ?? 3099);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WRITE_BASELINE = process.argv.includes('--write-baseline');

interface EndpointResult {
  name: string;
  path: string;
  requests: number;
  throughput: number;
  latency: {
    average: number;
    p50: number;
    p99: number;
    max: number;
  };
  errors: number;
  non2xx: number;
}

function runAutocannon(
  url: string,
  options: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<autocannon.Result> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        ...DEFAULT_BENCHMARK_OPTIONS,
        method: options.method ?? 'GET',
        body: options.body,
        headers: options.headers,
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
  throw new Error(`Server did not become ready at ${url}`);
}

function startBackend(): ChildProcess {
  return spawn(
    'npx',
    ['tsx', 'src/tests/benchmarks/serve.ts'],
    {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(PORT),
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'sk-benchmark-placeholder',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

async function runBenchmarks(): Promise<EndpointResult[]> {
  const server = startBackend();
  const results: EndpointResult[] = [];

  try {
    await waitForServer(`${BASE_URL}/health`);

    for (const endpoint of BENCHMARK_ENDPOINTS) {
      const url = `${BASE_URL}${endpoint.path}`;
      process.stdout.write(`Benchmarking ${endpoint.name} (${endpoint.method} ${endpoint.path})... `);

      const result = await runAutocannon(url, {
        method: endpoint.method,
        body: endpoint.body,
        headers: endpoint.headers,
      });

      const row: EndpointResult = {
        name: endpoint.name,
        path: endpoint.path,
        requests: result.requests.total,
        throughput: result.throughput.average,
        latency: {
          average: result.latency.average,
          p50: result.latency.p50,
          p99: result.latency.p99,
          max: result.latency.max,
        },
        errors: result.errors,
        non2xx: result.non2xx,
      };
      results.push(row);
      console.log(`p99=${row.latency.p99.toFixed(2)}ms`);
    }
  } finally {
    server.kill('SIGTERM');
  }

  return results;
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        port: PORT,
        endpoints: data,
      },
      null,
      2
    )
  );
}

async function main(): Promise<void> {
  console.log('AgenticPay API Benchmarks\n');
  const results = await runBenchmarks();

  writeJson(RESULTS_PATH, results);

  if (WRITE_BASELINE) {
    writeJson(BASELINE_PATH, results);
    console.log(`\nBaseline written to ${BASELINE_PATH}`);
  } else {
    console.log(`\nResults written to ${RESULTS_PATH}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
