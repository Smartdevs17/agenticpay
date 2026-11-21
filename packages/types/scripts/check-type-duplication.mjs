import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '../..');
const sharedTypesRoot = resolve(process.cwd(), 'src');
const searchRoots = ['backend/src', 'frontend', 'packages/sdk/src'];
const domainNames = [
  'Payment',
  'Transaction',
  'Merchant',
  'Project',
  'Milestone',
  'Dispute',
  'Invoice',
  'Receipt',
  'Refund',
  'Split',
  'User',
];

function collectFiles(dir, rootDir = dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const absPath = resolve(dir, entry);
    const stat = statSync(absPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(absPath, rootDir));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(absPath.slice(repoRoot.length + 1));
    }
  }
  return files;
}

const files = searchRoots.flatMap((root) => collectFiles(resolve(repoRoot, root)));

const duplicates = [];
for (const file of files) {
  const absPath = resolve(repoRoot, file);
  if (absPath.startsWith(sharedTypesRoot)) continue;
  const source = readFileSync(absPath, 'utf8');
  for (const name of domainNames) {
    const duplicatePattern = new RegExp(`export\\s+(interface|type)\\s+${name}\\b`);
    if (duplicatePattern.test(source) && !source.includes('@agenticpay/types')) {
      duplicates.push(`${file}: duplicate ${name}; import it from @agenticpay/types instead`);
    }
  }
}

if (duplicates.length > 0) {
  console.error(duplicates.join('\n'));
  process.exit(1);
}
