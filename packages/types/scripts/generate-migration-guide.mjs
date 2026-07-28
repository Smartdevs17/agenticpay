import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baseRef = process.env.TYPE_API_BASE_REF ?? 'HEAD~1';
const version = process.env.npm_package_version ?? '0.0.0';
const outDir = resolve(process.cwd(), 'migration-guides');
const outFile = resolve(outDir, `${version}.md`);

let diff = '';
try {
  diff = execFileSync('git', ['diff', '--unified=0', baseRef, '--', 'packages/types/src'], {
    cwd: resolve(process.cwd(), '../..'),
    encoding: 'utf8',
  });
} catch {
  diff = 'No git diff was available for this version.';
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
  outFile,
  [
    `# @agenticpay/types ${version} Migration Guide`,
    '',
    '## Summary',
    '',
    'Review the type surface changes below and update backend, frontend, and SDK imports to use @agenticpay/types.',
    '',
    '## Type Diff',
    '',
    '```diff',
    diff.trim() || 'No type changes detected.',
    '```',
    '',
    '## Checklist',
    '',
    '- Update package semver according to removed, changed, or added public fields.',
    '- Run `npm run check:breaking -w @agenticpay/types`.',
    '- Run `npm run check:duplicates -w @agenticpay/types`.',
    '',
  ].join('\n')
);

console.log(`Generated ${outFile}`);
