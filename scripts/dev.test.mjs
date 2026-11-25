import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const devScript = resolve(repoRoot, 'scripts/dev.sh');

function runDevScript(...args) {
  return spawnSync('bash', [devScript, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('scripts/dev.sh passes bash syntax checking', () => {
  const result = spawnSync('bash', ['-n', devScript], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('scripts/dev.sh --help prints usage and exits 0', () => {
  for (const flag of ['--help', '-h', 'help']) {
    const result = runDevScript(flag);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dev environment orchestrator/);
    assert.match(result.stdout, /scripts\/dev\.sh dev \[target\]/);
    assert.match(result.stdout, /scripts\/dev\.sh build \[target\]/);
    assert.match(result.stdout, /scripts\/dev\.sh lint \[target\]/);
    assert.match(result.stdout, /scripts\/dev\.sh test \[target\]/);
  }
});

test('scripts/dev.sh rejects unknown commands with exit code 1', () => {
  const result = runDevScript('unknown-subcommand');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dev environment orchestrator/);
});

test('scripts/dev.sh rejects unknown targets with exit code 1', () => {
  const result = runDevScript('test', 'nonexistent-pkg-name');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown target 'nonexistent-pkg-name'/);
});

test('scripts/dev.sh routes dev, build, lint, and test to make', () => {
  // Use a temporary PATH with a mock make to record invocations without executing real commands
  const actions = ['dev', 'build', 'lint', 'test'];
  for (const action of actions) {
    // all / default
    const allResult = spawnSync('bash', ['-c', `make() { echo "MOCK_MAKE: $*"; }; export -f make; bash "${devScript}" ${action}`], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(allResult.status, 0, allResult.stderr);
    assert.match(allResult.stdout, new RegExp(`MOCK_MAKE: ${action}`));

    // packages
    const pkgResult = spawnSync('bash', ['-c', `make() { echo "MOCK_MAKE: $*"; }; export -f make; bash "${devScript}" ${action} packages`], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(pkgResult.status, 0, pkgResult.stderr);
    assert.match(pkgResult.stdout, new RegExp(`MOCK_MAKE: ${action}-packages`));

    // specific package e.g. sdk
    const specificResult = spawnSync('bash', ['-c', `make() { echo "MOCK_MAKE: $*"; }; export -f make; bash "${devScript}" ${action} sdk`], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(specificResult.status, 0, specificResult.stderr);
    assert.match(specificResult.stdout, new RegExp(`MOCK_MAKE: ${action}-packages PKG=sdk`));

    // specific package with packages/ prefix
    const pathResult = spawnSync('bash', ['-c', `make() { echo "MOCK_MAKE: $*"; }; export -f make; bash "${devScript}" ${action} packages/sdk`], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(pathResult.status, 0, pathResult.stderr);
    assert.match(pathResult.stdout, new RegExp(`MOCK_MAKE: ${action}-packages PKG=sdk`));
  }
});
