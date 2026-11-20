// Pins the GitHub Actions supply-chain policy (#1468):
//
//   - every `uses:` in .github/workflows references an action by a full
//     40-character commit SHA, never a movable tag or branch, and carries the
//     release it corresponds to as a trailing `# <version>` comment so humans
//     and Dependabot can read and bump it;
//   - dtolnay/rust-toolchain, whose ref *is* the toolchain name, passes the
//     toolchain explicitly once its ref is a SHA;
//   - .github/dependabot.yml keeps those pins current and stays a valid v2
//     config (unknown top-level keys make GitHub reject the whole file).
//
// Run by `make test-tooling` in the CI "Repo tooling" job.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDir = join(repositoryRoot, '.github', 'workflows');

const USES = /^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)['"]?\s*(#.*)?$/;
const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/;
const DOCKER_DIGEST = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;

/** Every `uses:` line of every workflow, with its file and line number. */
export function collectUses(dir = workflowsDir) {
  const found = [];
  for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const match = USES.exec(line);
      if (match) {
        found.push({ file: name, line: index + 1, ref: match[1], comment: match[2] ?? '', lines, index });
      }
    });
  }
  return found;
}

/** Why `ref`/`comment` violates the pinning policy, or null when it complies. */
export function pinViolation(ref, comment) {
  if (ref.startsWith('./')) return null; // local action: versioned with this repo
  if (ref.startsWith('docker://')) {
    return DOCKER_DIGEST.test(ref) ? null : 'docker image must be pinned by @sha256 digest';
  }
  if (!ref.includes('@')) return 'missing @<commit-sha>';
  if (!PINNED.test(ref)) {
    return `pinned to "${ref.split('@')[1]}"; use the full 40-character commit SHA`;
  }
  if (!/^#\s*\S+/.test(comment)) return 'missing trailing "# <version>" comment for the pinned SHA';
  return null;
}

const uses = collectUses();
const remote = uses.filter(({ ref }) => !ref.startsWith('./'));

describe('pinViolation', () => {
  const sha = 'a'.repeat(40);

  test('accepts a SHA pin with a version comment, local actions and digest-pinned images', () => {
    assert.equal(pinViolation(`actions/checkout@${sha}`, '# v4.4.0'), null);
    assert.equal(pinViolation(`github/codeql-action/upload-sarif@${sha}`, '# v3.39.4'), null);
    assert.equal(pinViolation('./.github/actions/setup', ''), null);
    assert.equal(pinViolation(`docker://alpine@sha256:${'b'.repeat(64)}`, ''), null);
  });

  test('rejects tags, branches, short SHAs and missing refs', () => {
    assert.match(pinViolation('actions/checkout@v4', '# v4'), /full 40-character commit SHA/);
    assert.match(pinViolation('snyk/actions/node@master', ''), /full 40-character commit SHA/);
    assert.match(pinViolation('actions/checkout@11d5960', '# v4'), /full 40-character commit SHA/);
    assert.match(pinViolation(`actions/checkout@${'A'.repeat(40)}`, '# v4'), /full 40-character commit SHA/);
    assert.match(pinViolation('actions/checkout', ''), /missing @<commit-sha>/);
    assert.match(pinViolation('docker://alpine:3.20', ''), /sha256 digest/);
  });

  test('rejects a SHA pin without a version comment', () => {
    assert.match(pinViolation(`actions/checkout@${sha}`, ''), /version/);
    assert.match(pinViolation(`actions/checkout@${sha}`, '#'), /version/);
  });
});

describe('workflow action references', () => {
  test('the workflows directory has action references to check', () => {
    assert.ok(remote.length > 0, 'expected at least one remote action reference');
  });

  test('every action is pinned to a full commit SHA with a version comment', () => {
    const violations = uses
      .map((use) => ({ ...use, problem: pinViolation(use.ref, use.comment) }))
      .filter(({ problem }) => problem)
      .map(({ file, line, ref, problem }) => `.github/workflows/${file}:${line} ${ref}: ${problem}`);
    assert.deepEqual(violations, [], `unpinned actions:\n${violations.join('\n')}`);
  });

  test('one action release resolves to one SHA across all workflows', () => {
    // Keyed by action and version comment: rust-toolchain legitimately pins
    // two refs (stable, nightly), but "actions/checkout # v4.4.0" must never
    // point at two different commits.
    const byAction = new Map();
    for (const { ref, comment, file, line } of remote) {
      const [action, sha] = ref.split('@');
      const key = `${action} ${comment.trim()}`;
      if (!byAction.has(key)) byAction.set(key, new Map());
      byAction.get(key).set(sha, `${file}:${line}`);
    }
    const drift = [...byAction]
      .filter(([, shas]) => shas.size > 1)
      .map(([action, shas]) => `${action}: ${[...shas].map(([s, where]) => `${s.slice(0, 7)} (${where})`).join(', ')}`);
    assert.deepEqual(drift, [], `the same action is pinned to different SHAs:\n${drift.join('\n')}`);
  });

  test('dtolnay/rust-toolchain passes the toolchain explicitly once pinned', () => {
    const missing = remote
      .filter(({ ref }) => ref.startsWith('dtolnay/rust-toolchain@'))
      .filter(({ lines, index }) => {
        const indent = lines[index].search(/\S/) + (lines[index].trimStart().startsWith('- ') ? 2 : 0);
        for (let i = index + 1; i < lines.length; i++) {
          const text = lines[i];
          if (!text.trim()) continue;
          const col = text.search(/\S/);
          if (col < indent || (col === indent && !text.trim().startsWith('with:'))) break;
          if (/^\s*toolchain:\s*\S/.test(text)) return false;
        }
        return true;
      })
      .map(({ file, line }) => `.github/workflows/${file}:${line}`);
    assert.deepEqual(missing, [], `rust-toolchain steps without a toolchain input:\n${missing.join('\n')}`);
  });
});

describe('.github/dependabot.yml', () => {
  const config = readFileSync(join(repositoryRoot, '.github', 'dependabot.yml'), 'utf8');
  const topLevelKeys = config
    .split('\n')
    .filter((line) => /^[A-Za-z][\w-]*:/.test(line))
    .map((line) => line.split(':')[0]);

  test('only uses top-level keys Dependabot v2 accepts', () => {
    const allowed = new Set(['version', 'updates', 'registries', 'enable-beta-ecosystems', 'multi-ecosystem-groups']);
    assert.deepEqual(topLevelKeys.filter((key) => !allowed.has(key)), []);
    assert.match(config, /^version:\s*2\s*$/m);
  });

  test('keeps GitHub Actions pins up to date from the repository root', () => {
    const entries = config.split(/\n(?=\s*- package-ecosystem:)/);
    const actions = entries.find((entry) => /package-ecosystem:\s*["']?github-actions["']?/.test(entry));
    assert.ok(actions, 'missing a github-actions update entry');
    assert.match(actions, /directory:\s*["']?\/["']?\s*$/m);
    assert.match(actions, /interval:\s*["']?(daily|weekly|monthly)["']?/);
  });
});
