#!/usr/bin/env npx tsx
/**
 * Compare latest benchmark results against baseline.
 * Exits 1 if any endpoint p99 latency regressed by more than REGRESSION_THRESHOLD.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { REGRESSION_THRESHOLD } from './endpoints.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARKS_DIR = path.resolve(__dirname, '../../../benchmarks');
const BASELINE_PATH = path.join(BENCHMARKS_DIR, 'baseline.json');
const RESULTS_PATH = path.join(BENCHMARKS_DIR, 'results.json');
const TREND_PATH = path.join(BENCHMARKS_DIR, 'trend.md');

interface StoredRun {
  generatedAt: string;
  endpoints: Array<{
    name: string;
    latency: { p99: number };
  }>;
}

function load(path: string): StoredRun {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}. Run: npm run benchmark:baseline`);
  }
  return JSON.parse(fs.readFileSync(path, 'utf-8')) as StoredRun;
}

function appendTrend(lines: string[]): void {
  const header = fs.existsSync(TREND_PATH)
    ? ''
    : '# API Benchmark Trend\n\n| Date | Endpoint | Baseline p99 | Current p99 | Delta |\n|------|----------|--------------|-------------|-------|\n';
  fs.appendFileSync(TREND_PATH, header + lines.join('\n') + '\n');
}

function main(): void {
  const baseline = load(BASELINE_PATH);
  const current = fs.existsSync(RESULTS_PATH)
    ? load(RESULTS_PATH)
    : (() => {
        throw new Error(`Missing ${RESULTS_PATH}. Run: npm run benchmark`);
      })();

  const baselineMap = new Map(
    baseline.endpoints.map((e) => [e.name, e.latency.p99])
  );

  const regressions: string[] = [];
  const trendLines: string[] = [];
  const date = new Date().toISOString().slice(0, 10);

  for (const endpoint of current.endpoints) {
    const baseP99 = baselineMap.get(endpoint.name);
    if (baseP99 === undefined) continue;

    const curP99 = endpoint.latency.p99;
    const delta = (curP99 - baseP99) / baseP99;

    trendLines.push(
      `| ${date} | ${endpoint.name} | ${baseP99.toFixed(2)}ms | ${curP99.toFixed(2)}ms | ${(delta * 100).toFixed(1)}% |`
    );

    if (delta > REGRESSION_THRESHOLD) {
      regressions.push(
        `${endpoint.name}: p99 ${curP99.toFixed(2)}ms vs baseline ${baseP99.toFixed(2)}ms (+${(delta * 100).toFixed(1)}%)`
      );
    }
  }

  appendTrend(trendLines);

  if (regressions.length > 0) {
    console.error('Performance regression detected (>10% p99 increase):\n');
    regressions.forEach((r) => console.error(`  - ${r}`));
    process.exit(1);
  }

  console.log('All benchmarks within threshold.');
  console.log(`Trend log: ${TREND_PATH}`);
}

main();
