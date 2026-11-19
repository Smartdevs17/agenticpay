import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const makefile = readFileSync(resolve(repositoryRoot, 'Makefile'), 'utf8');
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

function make(...args) {
  const result = spawnSync('make', ['--no-print-directory', ...args], { cwd: repositoryRoot, encoding: 'utf8' });
  return { status: result.status, stdout: stripAnsi(result.stdout), stderr: stripAnsi(result.stderr) };
}

function scriptsOf(dir) {
  const manifest = resolve(repositoryRoot, dir, 'package.json');
  assert.ok(existsSync(manifest), `Makefile points npm at ${dir}, which has no package.json`);
  return JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {};
}

const phonyTargets = [...makefile.matchAll(/^\.PHONY:\s*(.+)$/gm)].flatMap((m) => m[1].trim().split(/\s+/));
const documented = new Map(
  [...makefile.matchAll(/^([a-zA-Z0-9_-]+):[^\n]*## (.+)$/gm)].map((m) => [m[1], m[2]]),
);
// Optional flags change which npm script a target resolves to; dry-run each variant.
const VARIANTS = [[], ['SCOPE=evm'], ['SCOPE=soroban'], ['WATCH=1'], ['SMOKE=1'], ['CONFIRM=1']];
// `npm [--prefix dir] run <script>`, plus the `npm test` / `npm ci` shorthands.
const NPM_SCRIPT = /\bnpm(?: --prefix (\S+))? (?:run ([^\s;)]+)|(test|ci)\b)/g;

function dryRunCommands() {
  const lines = [];
  for (const target of documented.keys()) {
    for (const variant of VARIANTS) {
      const { status, stdout, stderr } = make('-n', target, ...variant);
      assert.equal(status, 0, `make -n ${target} ${variant.join(' ')} failed:\n${stderr}`);
      lines.push(...stdout.split('\n'));
    }
  }
  return lines;
}

test('running make with no target prints the help screen', () => {
  const bare = make();
  assert.equal(bare.status, 0);
  assert.equal(bare.stdout, make('help').stdout);
});

test('every phony target is documented in help, and help lists only real targets', () => {
  const help = make('help').stdout;
  for (const target of phonyTargets) {
    assert.ok(documented.has(target), `target "${target}" has no "## description" so help hides it`);
    assert.match(help, new RegExp(`^\\s+${target}\\s+${documented.get(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
  for (const target of documented.keys()) {
    assert.ok(phonyTargets.includes(target), `target "${target}" is not declared .PHONY`);
  }
});

test('every npm script a target invokes exists in the package it targets', () => {
  const lines = dryRunCommands();
  let checked = 0;
  for (const line of lines) {
    for (const match of line.matchAll(NPM_SCRIPT)) {
      const [, dir = '.', script = match[3]] = match;
      if (script === 'ci') continue;
      assert.ok(scriptsOf(dir)[script], `"${line.trim()}" runs missing script "${script}" in ${dir}/package.json`);
      checked += 1;
    }
  }
  assert.ok(checked > 30, `expected to verify the npm script mapping, only saw ${checked}`);
});

test('every root npm script is reachable from a make target', () => {
  const reached = new Set(
    dryRunCommands()
      .flatMap((line) => [...line.matchAll(NPM_SCRIPT)])
      .filter((match) => !match[1])
      .map((match) => match[2] ?? match[3]),
  );
  // release runs only in the release workflow; test:docs runs inside `npm test` (make test).
  const notDevTasks = new Set(['release', 'test:docs']);
  const unmapped = Object.keys(scriptsOf('.')).filter((script) => !notDevTasks.has(script) && !reached.has(script));
  assert.deepEqual(unmapped, [], 'add a make target for these root scripts');
});

test('a missing required tool fails fast with an install hint', () => {
  const result = make('doctor', 'NODE=__missing_node__');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required tool: __missing_node__ — install Node\.js 20\+/);
});

test('doctor passes on a working toolchain', () => {
  const result = make('doctor');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /✓ node v\d+/);
});

test('db-reset refuses to run without CONFIRM=1', () => {
  const result = make('db-reset');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /re-run with CONFIRM=1/);
  assert.match(make('-n', 'db-reset', 'CONFIRM=1').stdout, /npm --prefix backend run db:reset/);
});

test('tool binaries and single-file test runs can be overridden', () => {
  assert.match(make('-n', 'test-backend', 'NPM=pnpm').stdout, /^pnpm --prefix backend run test$/m);
  assert.match(
    make('-n', 'test-backend', 'FILE=src/services/__tests__/settlementProof.test.ts').stdout,
    /npm --prefix backend run test -- src\/services\/__tests__\/settlementProof\.test\.ts/,
  );
  assert.match(make('-n', 'up', 'COMPOSE=podman compose').stdout, /^podman compose up -d$/m);
});

test('integration tests always tear the docker stack down, even on failure', () => {
  const { stdout } = make('-n', 'test-integration');
  assert.match(stdout, /\(npm run test:integration; rc=\$\?; npm run test:integration:down; exit \$rc\); status=\$\?/);
});

test('TIMINGS=1 reports duration and preserves the wrapped command exit code', () => {
  // Probe targets are appended from stdin so the `timed` helper is exercised without running real tasks.
  const probe = (command) =>
    spawnSync('make', ['--no-print-directory', '-f', 'Makefile', '-f', '-', 'probe', 'TIMINGS=1'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      input: `probe:\n\t$(call timed,probe,${command})\n`,
    });

  const ok = probe('true');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /⏱ {2}probe finished in \d+s \(exit 0\)/);

  const failed = probe('exit 3');
  assert.notEqual(failed.status, 0);
  assert.match(failed.stdout, /⏱ {2}probe finished in \d+s \(exit 3\)/);
});
