// Pins scripts/no-console.sh and the husky pre-push hook that runs it (#1651):
// pushes that add console.log to app code are blocked; tests, tooling,
// existing calls and other console methods are not.
//
// Needs only git and bash; no npm install. Run with `make test-tooling`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'no-console.sh');
const HOOK = join(ROOT, '.husky', 'pre-push');
const ZERO = '0'.repeat(40);

function run(cmd, args, cwd, input) {
  const res = spawnSync(cmd, args, {
    cwd,
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

const git = (cwd, ...args) => {
  const r = run('git', args, cwd);
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.out}`);
  return r.out.trim();
};

function write(repo, path, content) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

function commit(repo, files, message = 'change') {
  for (const [path, content] of Object.entries(files)) write(repo, path, content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

// A repo with the script and hook copied in, one baseline commit that already
// contains console.log in app code, pushed to a bare "origin".
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'no-console-'));
  const origin = join(dir, 'origin.git');
  const repo = join(dir, 'repo');
  git(dir, 'init', '-q', '--bare', origin);
  git(dir, 'init', '-q', '-b', 'main', repo);
  mkdirSync(join(repo, 'scripts'));
  mkdirSync(join(repo, '.husky'));
  copyFileSync(SCRIPT, join(repo, 'scripts', 'no-console.sh'));
  copyFileSync(HOOK, join(repo, '.husky', 'pre-push'));
  const base = commit(repo, {
    'backend/src/legacy.ts': 'export function f() {\n  console.log("old");\n  return 1;\n}\n',
    'README.md': '# t\n',
  }, 'baseline');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '--no-verify', 'origin', 'main');
  return { repo, base };
}

const check = (repo, ...args) => run('bash', ['scripts/no-console.sh', ...args], repo);
const hook = (repo, lines) => run('sh', ['.husky/pre-push', 'origin', 'url'], repo, lines.join('\n') + '\n');

describe('scripts/no-console.sh', () => {
  test('blocks console.log added to backend, frontend and workers app code, with file:line', () => {
    const { repo, base } = setup();
    commit(repo, {
      'backend/src/pay.ts': 'export const a = 1;\nconsole.log("debug", a);\n',
      'frontend/components/Button.tsx': 'export const B = () => {\n  console.log ("render");\n  return null;\n};\n',
      'workers/src/job.js': 'console.log(`job`);\n',
    });
    const r = check(repo, base);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /3 console\.log call\(s\) added to app code/);
    assert.match(r.out, /backend\/src\/pay\.ts:2: console\.log\("debug", a\);/);
    assert.match(r.out, /frontend\/components\/Button\.tsx:2: console\.log \("render"\);/);
    assert.match(r.out, /workers\/src\/job\.js:1: console\.log\(`job`\);/);
    assert.match(r.out, /git push --no-verify/);
  });

  test('ignores tests, tooling, config files, non-code files and code outside the app dirs', () => {
    const { repo, base } = setup();
    commit(repo, {
      'backend/src/pay.test.ts': 'console.log(1);\n',
      'backend/src/__tests__/x.ts': 'console.log(1);\n',
      'frontend/e2e/flow.spec.ts': 'console.log(1);\n',
      'frontend/tests/helpers.ts': 'console.log(1);\n',
      'backend/scripts/seed-data.ts': 'console.log(1);\n',
      'backend/migrations/runner.ts': 'console.log(1);\n',
      'backend/prisma/seed/factories.ts': 'console.log(1);\n',
      'backend/benchmarks/tax.bench.ts': 'console.log(1);\n',
      'frontend/next.config.ts': 'console.log(1);\n',
      'backend/docs/GUIDE.md': 'console.log(1)\n',
      'packages/log-viewer/src/cli.ts': 'console.log(1);\n',
      'scripts/tool.mjs': 'console.log(1);\n',
    });
    const r = check(repo, base);
    assert.equal(r.code, 0, r.out);
  });

  test('does not flag existing console.log when other lines of the file change', () => {
    const { repo, base } = setup();
    commit(repo, {
      'backend/src/legacy.ts': 'export function f() {\n  console.log("old");\n  return 2;\n}\n',
    });
    assert.equal(check(repo, base).code, 0);
  });

  test('allows other console methods, comments and an explicit eslint-disable-line', () => {
    const { repo, base } = setup();
    commit(repo, {
      'backend/src/ok.ts': [
        'console.error("boom");',
        'console.warn("careful");',
        'console.info("hi");',
        '// console.log("commented out")',
        '  /* console.log("block") */',
        ' * console.log("jsdoc example")',
        'console.log("intentional"); // eslint-disable-line no-console',
        'const logger = { log: () => {} }; logger.log("x");',
        '',
      ].join('\n'),
    });
    const r = check(repo, base);
    assert.equal(r.code, 0, r.out);
  });

  test('checks every commit in the range, not just the last one', () => {
    const { repo, base } = setup();
    commit(repo, { 'backend/src/a.ts': 'console.log("a");\n' }, 'first');
    commit(repo, { 'README.md': '# t2\n' }, 'second');
    const r = check(repo, base);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /backend\/src\/a\.ts:1:/);
  });

  test('a console.log removed again later in the range is not reported', () => {
    const { repo, base } = setup();
    commit(repo, { 'backend/src/a.ts': 'console.log("a");\n' });
    commit(repo, { 'backend/src/a.ts': 'export {};\n' });
    assert.equal(check(repo, base).code, 0);
  });

  test('without a base, checks only commits that are not on any remote', () => {
    const { repo } = setup();
    assert.equal(check(repo).code, 0, 'nothing new: clean');
    commit(repo, { 'backend/src/a.ts': 'console.log("a");\n' });
    const r = check(repo);
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(r.out, /legacy\.ts/, 'pushed history is not rescanned');
  });

  test('an unknown base falls back to the not-on-any-remote range instead of failing', () => {
    const { repo } = setup();
    commit(repo, { 'backend/src/a.ts': 'console.log("a");\n' });
    const r = check(repo, 'f'.repeat(40));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /backend\/src\/a\.ts:1:/);
  });

  test('exits 2 on an unknown head or too many arguments', () => {
    const { repo, base } = setup();
    assert.equal(check(repo, base, 'no-such-ref').code, 2);
    assert.equal(check(repo, base, 'HEAD', 'extra').code, 2);
  });

  test('is executable', () => {
    assert.ok(statSync(SCRIPT).mode & 0o111, 'scripts/no-console.sh must be executable');
  });
});

describe('.husky/pre-push', () => {
  test('blocks a push whose new commits add console.log', () => {
    const { repo, base } = setup();
    const head = commit(repo, { 'backend/src/a.ts': 'console.log("a");\n' });
    const r = hook(repo, [`refs/heads/main ${head} refs/heads/main ${base}`]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /backend\/src\/a\.ts:1:/);
  });

  test('lets a clean push through', () => {
    const { repo, base } = setup();
    const head = commit(repo, { 'backend/src/a.ts': 'console.error("a");\n' });
    assert.equal(hook(repo, [`refs/heads/main ${head} refs/heads/main ${base}`]).code, 0);
  });

  test('new branch (remote sha all zeros) checks only commits not yet on a remote', () => {
    const { repo } = setup();
    git(repo, 'checkout', '-q', '-b', 'feat');
    const clean = commit(repo, { 'backend/src/b.ts': 'export {};\n' });
    assert.equal(hook(repo, [`refs/heads/feat ${clean} refs/heads/feat ${ZERO}`]).code, 0);
    const dirty = commit(repo, { 'frontend/lib/c.ts': 'console.log("c");\n' });
    const r = hook(repo, [`refs/heads/feat ${dirty} refs/heads/feat ${ZERO}`]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /frontend\/lib\/c\.ts:1:/);
  });

  test('deleting a remote branch is never blocked', () => {
    const { repo } = setup();
    commit(repo, { 'backend/src/a.ts': 'console.log("a");\n' });
    assert.equal(hook(repo, [`(delete) ${ZERO} refs/heads/old ${'a'.repeat(40)}`]).code, 0);
  });

  test('checks every ref in a multi-ref push', () => {
    const { repo, base } = setup();
    const head = commit(repo, { 'backend/src/a.ts': 'console.log("a");\n' });
    const r = hook(repo, [
      `(delete) ${ZERO} refs/heads/old ${'a'.repeat(40)}`,
      `refs/heads/main ${head} refs/heads/main ${base}`,
    ]);
    assert.equal(r.code, 1, r.out);
  });

  test('runs on a real `git push` and stops it before anything reaches the remote', () => {
    const { repo, base } = setup();
    git(repo, 'config', 'core.hooksPath', '.husky');
    commit(repo, { 'backend/src/a.ts': 'console.log("a");\n' });
    const blocked = run('git', ['push', 'origin', 'main'], repo);
    assert.notEqual(blocked.code, 0, blocked.out);
    assert.match(blocked.out, /no-console: 1 console\.log call\(s\) added to app code/);
    assert.equal(git(repo, 'rev-parse', 'origin/main'), base, 'remote must not move');
    commit(repo, { 'backend/src/a.ts': 'console.error("a");\n' });
    const pushed = run('git', ['push', 'origin', 'main'], repo);
    assert.equal(pushed.code, 0, pushed.out);
  });

  test('documents how to skip the hook, like commit-msg does', () => {
    const text = readFileSync(HOOK, 'utf8');
    assert.match(text, /--no-verify/);
    assert.match(text, /HUSKY=0/);
    assert.match(text, /scripts\/no-console\.sh/);
  });
});
