import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(repoRoot, 'scripts/setup.sh');
const scriptText = readFileSync(script, 'utf8');
const pinned = scriptText.match(/^SOROBAN_CLI_VERSION="([^"]+)"/m)?.[1];

// Only the system directories, so grep/awk/sed exist but no real rustup or soroban does.
const SYSTEM_PATH = '/usr/bin:/bin';

function withShims(shims, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'setup-shims-'));
  try {
    for (const [name, body] of Object.entries(shims)) {
      const file = join(dir, name);
      writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(file, 0o755);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runSetup(args, pathDirs) {
  return spawnSync('/bin/bash', [script, ...args], {
    encoding: 'utf8',
    env: { PATH: [...pathDirs, SYSTEM_PATH].join(':'), HOME: tmpdir() },
  });
}

const healthyShims = {
  rustup: [
    'if [ "$1 $2" = "target list" ]; then echo "wasm32-unknown-unknown"; exit 0; fi',
    'if [ "$1 $2" = "component list" ]; then printf "clippy-x86_64-unknown-linux-gnu\\nrustfmt-x86_64-unknown-linux-gnu\\n"; exit 0; fi',
    'exit 0',
  ].join('\n'),
  cargo: 'exit 0',
  rustc: 'echo "rustc 1.93.0 (test)"',
  soroban: `echo "soroban ${pinned}"`,
};

test('setup.sh passes bash syntax checking', () => {
  const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('--help prints usage and exits 0', () => {
  const result = runSetup(['--help'], []);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--check/);
});

test('an unknown option exits 2', () => {
  const result = runSetup(['--bogus'], []);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option: --bogus/);
});

test('fails with an install hint when rustup is not installed', () => {
  withShims({ cargo: 'exit 0' }, (dir) => {
    const result = runSetup(['--check'], [dir]);
    assert.equal(result.status, 127);
    assert.match(result.stderr, /rustup is required/);
  });
});

test('--check exits 0 when the whole toolchain is present at the pinned version', () => {
  withShims(healthyShims, (dir) => {
    const result = runSetup(['--check'], [dir]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /ok\s+soroban/);
    assert.match(result.stdout, /Toolchain ready/);
  });
});

test('--check reports a missing wasm target and exits 1 without installing it', () => {
  const shims = {
    ...healthyShims,
    rustup: healthyShims.rustup.replace('echo "wasm32-unknown-unknown"', 'echo "x86_64-unknown-linux-gnu"'),
  };
  withShims(shims, (dir) => {
    const result = runSetup(['--check'], [dir]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /missing\s+wasm32-unknown-unknown/);
    assert.match(result.stderr, /1 item\(s\) missing/);
  });
});

test('--check reports a soroban CLI at the wrong version as missing', () => {
  const shims = { ...healthyShims, soroban: 'echo "soroban 20.0.0"' };
  withShims(shims, (dir) => {
    const result = runSetup(['--check'], [dir]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`missing\\s+soroban ${pinned.replace(/\./g, '\\.')} \\(found: 20\\.0\\.0\\)`));
  });
});

test('the pinned soroban CLI version matches soroban-sdk in contracts/Cargo.toml', () => {
  const cargo = readFileSync(resolve(repoRoot, 'contracts/Cargo.toml'), 'utf8');
  const sdk = cargo.match(/^soroban-sdk = "([^"]+)"/m)?.[1];
  assert.ok(pinned, 'setup.sh must pin SOROBAN_CLI_VERSION');
  assert.equal(pinned, sdk);
});

test('the devcontainer image builds the same soroban CLI version', () => {
  const dockerfile = readFileSync(resolve(repoRoot, '.devcontainer/Dockerfile'), 'utf8');
  assert.match(dockerfile, new RegExp(`ARG SOROBAN_CLI_VERSION=${pinned.replace(/\./g, '\\.')}\\b`));
});

test('post-create delegates to scripts/setup.sh instead of duplicating the install', () => {
  const postCreate = readFileSync(resolve(repoRoot, '.devcontainer/post-create.sh'), 'utf8');
  assert.match(postCreate, /bash scripts\/setup\.sh/);
  assert.doesNotMatch(postCreate, /cargo install --locked soroban-cli/);
});
