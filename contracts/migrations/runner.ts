import { analyzeStorageLayout, compareLayouts } from './analyze-layout.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Migration System Runner
 * Orchestrates the storage layout analysis and migration workflow.
 */

async function run() {
  const contractName = process.argv[2] || 'Splitter';
  const oldLayoutPath = process.argv[3];
  const newContractPath = process.argv[4] || `contracts/${contractName}.sol`;

  if (!oldLayoutPath) {
    console.log('[Info] No old layout provided. Initializing baseline layout.');
    const layout = analyzeStorageLayout(newContractPath, contractName);
    const baselinePath = `contracts/migrations/${contractName}.baseline.json`;
    fs.writeFileSync(baselinePath, JSON.stringify(layout, null, 2));
    console.log(`[Success] Baseline layout saved to ${baselinePath}`);
    return;
  }

  const oldLayout = JSON.parse(fs.readFileSync(oldLayoutPath, 'utf-8'));
  const newLayout = analyzeStorageLayout(newContractPath, contractName);

  const { shifts, deletions, additions } = compareLayouts(oldLayout, newLayout);

  console.log('\n--- Storage Layout Comparison ---');
  console.log(`Additions: ${additions.length}`);
  additions.forEach(a => console.log(`  + ${a}`));
  
  console.log(`Deletions: ${deletions.length}`);
  deletions.forEach(d => console.log(`  - ${d}`));
  
  console.log(`Shifts: ${shifts.length}`);
  shifts.forEach(s => console.log(`  ! ${s}`));

  if (shifts.length > 0 || deletions.length > 0) {
    console.warn('\n[Warning] Critical storage changes detected! Migration contract recommended.');
  } else {
    console.log('\n[Success] Storage layout is compatible (append-only).');
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
