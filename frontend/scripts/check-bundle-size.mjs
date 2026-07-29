#!/usr/bin/env node
// CI bundle-size budget check. Sums `.next/static/chunks/**/*.js` (gzip size)
// against `bundle-budget.json`, both in total and for the named route chunks
// produced by the splitChunks cacheGroups in next.config.ts.
import { readFileSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const chunksDir = join(root, '.next', 'static', 'chunks');
const budgetPath = join(root, 'bundle-budget.json');

if (!existsSync(chunksDir)) {
  console.error(`No build output found at ${chunksDir}. Run \`next build\` first.`);
  process.exit(1);
}

const budget = JSON.parse(readFileSync(budgetPath, 'utf-8'));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = walk(chunksDir);
let totalGzipBytes = 0;
const chunkGzipBytes = {};

for (const file of files) {
  const gz = gzipSync(readFileSync(file)).length;
  totalGzipBytes += gz;

  for (const chunkName of Object.keys(budget.chunks)) {
    if (file.includes(chunkName)) {
      chunkGzipBytes[chunkName] = (chunkGzipBytes[chunkName] ?? 0) + gz;
    }
  }
}

const totalKb = totalGzipBytes / 1024;
const violations = [];

console.log(`Total JS (gzip): ${totalKb.toFixed(1)} KB (budget: ${budget.totalJsKb} KB)`);
if (totalKb > budget.totalJsKb) {
  violations.push(`Total JS bundle ${totalKb.toFixed(1)} KB exceeds budget ${budget.totalJsKb} KB`);
}

for (const [chunkName, budgetKb] of Object.entries(budget.chunks)) {
  const actualKb = (chunkGzipBytes[chunkName] ?? 0) / 1024;
  console.log(`  ${chunkName}: ${actualKb.toFixed(1)} KB (budget: ${budgetKb} KB)`);
  if (actualKb > budgetKb) {
    violations.push(`Chunk "${chunkName}" ${actualKb.toFixed(1)} KB exceeds budget ${budgetKb} KB`);
  }
}

if (violations.length > 0) {
  console.error('\nBundle size budget exceeded:');
  violations.forEach((v) => console.error(`  - ${v}`));
  process.exit(1);
}

console.log('\nAll bundle chunks are within budget.');
