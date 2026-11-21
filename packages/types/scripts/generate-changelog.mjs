import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = process.env.npm_package_version ?? '0.0.0';
const today = new Date().toISOString().slice(0, 10);
const changelogPath = resolve(process.cwd(), 'CHANGELOG.md');

let changedFiles = '';
try {
  changedFiles = execFileSync('git', ['diff', '--name-only', 'HEAD~1', '--', 'packages/types/src'], {
    cwd: resolve(process.cwd(), '../..'),
    encoding: 'utf8',
  }).trim();
} catch {
  changedFiles = 'packages/types/src';
}

const existing = readFileSync(changelogPath, 'utf8');
const entry = [
  `## ${version} - ${today}`,
  '',
  '### Changed',
  '',
  ...(changedFiles ? changedFiles.split('\n').map((file) => `- Updated ${file}`) : ['- No public type files changed.']),
  '',
].join('\n');

if (!existing.includes(`## ${version} - `)) {
  writeFileSync(changelogPath, existing.replace(/^# Changelog\s*/u, `# Changelog\n\n${entry}\n`));
}

console.log(`Updated ${changelogPath}`);
