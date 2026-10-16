import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = resolve(repositoryRoot, 'docs/README.md');

function localMarkdownTargets(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim())
    .filter((target) => !target.startsWith('#') && !/^[a-z][a-z\d+.-]*:/i.test(target))
    .map((target) => decodeURIComponent(target.split('#', 1)[0]));
}

test('the documentation index only links to existing local files', () => {
  const markdown = readFileSync(indexPath, 'utf8');
  const missing = localMarkdownTargets(markdown)
    .map((target) => resolve(dirname(indexPath), target))
    .filter((target) => !existsSync(target));

  assert.deepEqual(missing, []);
});
