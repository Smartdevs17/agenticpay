// Pins the Conventional Commits policy (commitlint.config.js), the husky
// commit-msg hook that enforces it locally, and the semantic-release config
// that turns those commits into versions and CHANGELOG.md entries.
//
// Requires root devDependencies: run `npm ci` at the repo root first.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const COMMITLINT_BIN = join(ROOT, 'node_modules', '.bin', 'commitlint');

assert.ok(
  existsSync(COMMITLINT_BIN),
  'commitlint is not installed — run `npm ci` at the repo root before `make test-tooling`',
);
const { analyzeCommits } = await import('@semantic-release/commit-analyzer');

function lint(message) {
  const res = spawnSync(COMMITLINT_BIN, [], { cwd: ROOT, input: message, encoding: 'utf8' });
  return { ok: res.status === 0, output: `${res.stdout}${res.stderr}` };
}

function writeTempMessage(message) {
  const file = join(mkdtempSync(join(tmpdir(), 'commitmsg-')), 'COMMIT_EDITMSG');
  writeFileSync(file, message);
  return file;
}

const config = require(join(ROOT, 'commitlint.config.js'));
const releaserc = JSON.parse(readFileSync(join(ROOT, '.releaserc.json'), 'utf8'));
const pluginOptions = (name) => {
  const entry = releaserc.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  assert.ok(entry, `${name} missing from .releaserc.json`);
  return Array.isArray(entry) ? entry[1] : {};
};

describe('commitlint policy', () => {
  test('is the only commitlint config in the repo', () => {
    for (const f of ['.commitlintrc', '.commitlintrc.json', '.commitlintrc.js', 'commitlint.config.mjs']) {
      assert.ok(!existsSync(join(ROOT, f)), `duplicate commitlint config ${f}`);
    }
  });

  for (const message of [
    'feat: add payout approval endpoint',
    'fix(payments): handle missing invoice validation',
    'feat(api)!: drop v1 invoice routes',
    'perf: cache exchange rates',
    'chore(deps): bump next from 16.2.1 to 16.2.2',
    'docs: explain sandbox faucet\n\nLonger body explaining the change.',
    'refactor: split router\n\nBREAKING CHANGE: `createRouter` now takes an options object',
  ]) {
    test(`accepts: ${message.split('\n')[0]}`, () => {
      const res = lint(message);
      assert.ok(res.ok, res.output);
    });
  }

  for (const [why, message, rule] of [
    ['missing type', 'add payout approval endpoint', 'type-empty'],
    ['unknown type', 'feature: add payout approval endpoint', 'type-enum'],
    ['upper-case type', 'FEAT: add payout approval endpoint', 'type-case'],
    ['empty subject', 'feat: ', 'subject-empty'],
    ['upper-case subject', 'feat: ADD PAYOUT ENDPOINT', 'subject-case'],
    ['header over 100 chars', `feat: ${'a'.repeat(100)}`, 'header-max-length'],
    ['body line over 200 chars', `fix: thing\n\n${'b'.repeat(201)}`, 'body-max-line-length'],
  ]) {
    test(`rejects ${why}`, () => {
      const res = lint(message);
      assert.equal(res.ok, false, `expected "${message}" to be rejected`);
      assert.match(res.output, new RegExp(`\\[${rule}\\]`));
    });
  }

  test('points failing contributors at the contributing guide', () => {
    assert.match(lint('nope').output, /CONTRIBUTING\.md#commit-message-format/);
  });

  test('ignores semantic-release commits even with long generated notes', () => {
    const notes = `* **payments:** ${'x'.repeat(250)} ([abc1234](https://github.com/Smartdevs17/agenticpay/commit/abc1234))`;
    assert.ok(lint(`chore(release): 1.4.0 [skip ci]\n\n${notes}`).ok);
  });

  test('ignores git-generated merge commits', () => {
    assert.ok(lint("Merge branch 'main' into feat/payment-status").ok);
  });

  test('type-enum covers exactly the documented types', () => {
    assert.deepEqual(
      [...config.rules['type-enum'][2]].sort(),
      ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'],
    );
  });
});

describe('husky commit-msg hook', () => {
  const hook = join(ROOT, '.husky', 'commit-msg');
  const runHook = (message) =>
    spawnSync('sh', [hook, writeTempMessage(message)], { cwd: ROOT, encoding: 'utf8' });

  test('passes a conventional message', () => {
    const res = runHook('fix: handle empty payout batch\n');
    assert.equal(res.status, 0, res.stdout + res.stderr);
  });

  test('blocks a non-conventional message', () => {
    const res = runHook('fixed stuff\n');
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /type-empty/);
  });

  test('is the only git hook, so no hook depends on unconfigured tooling', () => {
    const hooks = ['pre-commit', 'pre-push', 'prepare-commit-msg'].filter((h) =>
      existsSync(join(ROOT, '.husky', h)),
    );
    assert.deepEqual(hooks, []);
  });

  test('is installed by `npm install`', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.prepare, 'node .husky/install.mjs');
    const res = spawnSync(process.execPath, ['.husky/install.mjs'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
  });

  test('install step is a no-op where husky is not installed', () => {
    // e.g. `npm ci` in frontend/, whose lockfile has no husky but which still
    // runs the root `prepare` script.
    const dir = mkdtempSync(join(tmpdir(), 'no-husky-'));
    writeFileSync(join(dir, 'install.mjs'), readFileSync(join(ROOT, '.husky', 'install.mjs')));
    const res = spawnSync(process.execPath, ['install.mjs'], { cwd: dir, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /husky not installed; skipping/);
  });
});

describe('semantic-release changelog', () => {
  const analyzer = pluginOptions('@semantic-release/commit-analyzer');
  const notes = pluginOptions('@semantic-release/release-notes-generator');

  test('uses the conventionalcommits preset end to end', () => {
    assert.equal(analyzer.preset, 'conventionalcommits');
    assert.equal(notes.preset, 'conventionalcommits');
  });

  test('declares every commitlint type in the release notes config', () => {
    const declared = notes.presetConfig.types.map((t) => t.type).sort();
    assert.deepEqual(declared, [...config.rules['type-enum'][2]].sort());
  });

  test('writes and commits CHANGELOG.md', () => {
    assert.equal(pluginOptions('@semantic-release/changelog').changelogFile, 'CHANGELOG.md');
    assert.deepEqual(pluginOptions('@semantic-release/git').assets, ['CHANGELOG.md']);
  });

  test('release commit message is exempt from commitlint', () => {
    const message = pluginOptions('@semantic-release/git')
      .message.replace('${nextRelease.version}', '2.0.0')
      .replace('${nextRelease.notes}', `* ${'n'.repeat(300)}`);
    assert.ok(lint(message).ok);
  });

  const logger = { log() {}, error() {}, warn() {}, success() {} };
  const bump = (...messages) =>
    analyzeCommits(analyzer, {
      cwd: ROOT,
      logger,
      options: releaserc,
      commits: messages.map((message, i) => ({ hash: `${i}`, message })),
    });

  for (const [messages, expected] of [
    [['docs: update readme', 'chore: tidy', 'ci: cache'], null],
    [['fix: handle null payout'], 'patch'],
    [['perf: cache exchange rates'], 'patch'],
    [['feat(payments): add razorpay'], 'minor'],
    [['fix: a', 'feat: b'], 'minor'],
    [['feat(api)!: drop v1 routes'], 'major'],
    [['refactor: router\n\nBREAKING CHANGE: new signature'], 'major'],
  ]) {
    test(`${messages.join(' + ')} -> ${expected ?? 'no release'}`, async () => {
      assert.equal(await bump(...messages), expected);
    });
  }
});
