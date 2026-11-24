import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(repositoryRoot, 'scripts/dr-drill.sh');

/**
 * Runs the drill with a clean environment. Every case here is a guard that refuses before any
 * database call, so no Postgres is needed.
 */
function drill(args, env = {}) {
  const result = spawnSync('bash', [script, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME ?? '', ...env },
  });
  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

const PRIMARY = 'postgres://primary.example.test/app';
const STANDBY = 'postgres://drill-standby.example.test/app';

test('requires the primary and standby URLs', () => {
  const result = drill([], { DRILL_STANDBY_URL: STANDBY });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DRILL_PRIMARY_URL is required/);
});

test('refuses when the standby is the same database as the primary', () => {
  const result = drill([], { DRILL_PRIMARY_URL: PRIMARY, DRILL_STANDBY_URL: PRIMARY });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /primary and standby are the same database/);
});

test('refuses --execute without the explicit confirmation', () => {
  const result = drill(['--execute'], { DRILL_PRIMARY_URL: PRIMARY, DRILL_STANDBY_URL: STANDBY });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DR_DRILL_CONFIRM=promote-drill-replica/);
});

test('refuses --execute when the confirmation value is wrong', () => {
  const result = drill(['--execute'], {
    DRILL_PRIMARY_URL: PRIMARY,
    DRILL_STANDBY_URL: STANDBY,
    DR_DRILL_CONFIRM: 'yes',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DR_DRILL_CONFIRM=promote-drill-replica/);
});

test('rejects an unknown argument with usage and exit code 2', () => {
  const result = drill(['--promote-now'], { DRILL_PRIMARY_URL: PRIMARY, DRILL_STANDBY_URL: STANDBY });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage:/);
});
