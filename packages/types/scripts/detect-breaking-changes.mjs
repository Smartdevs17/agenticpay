import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '../..');
const baseRef = process.env.TYPE_API_BASE_REF ?? 'HEAD~1';
const current = execFileSync('npm', ['run', 'build', '--workspace', '@agenticpay/types'], {
  cwd: repoRoot,
  encoding: 'utf8',
});
if (current) process.stdout.write(current);

const currentDts = readFileSync(resolve(process.cwd(), 'dist/index.d.ts'), 'utf8');
let previousDts = '';

try {
  previousDts = execFileSync('git', ['show', `${baseRef}:packages/types/dist/index.d.ts`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  try {
    const tmp = join(tmpdir(), `agenticpay-types-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    execFileSync('git', ['archive', baseRef, 'packages/types'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] });
    previousDts = '';
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    console.log('No previous type declaration baseline found; skipping breaking-change detection.');
    process.exit(0);
  }
}

const removedExports = [];
for (const match of previousDts.matchAll(/^export\s+(?:declare\s+)?(?:interface|type|class|function|const)\s+(\w+)/gm)) {
  const name = match[1];
  const stillExists = new RegExp(`^export\\s+(?:declare\\s+)?(?:interface|type|class|function|const)\\s+${name}\\b`, 'm').test(currentDts);
  if (!stillExists) removedExports.push(name);
}

if (removedExports.length > 0) {
  writeFileSync(
    resolve(process.cwd(), 'TYPE_BREAKING_CHANGES.md'),
    [
      '# Type Breaking Changes',
      '',
      'The following public exports were removed and require a major version bump plus migration guide:',
      '',
      ...removedExports.map((name) => `- ${name}`),
      '',
    ].join('\n')
  );
  console.error(`Breaking type changes detected: ${removedExports.join(', ')}`);
  process.exit(1);
}

console.log('No removed public type exports detected.');
