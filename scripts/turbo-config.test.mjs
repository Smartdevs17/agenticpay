import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(repositoryRoot, path), 'utf8');

const turbo = JSON.parse(read('turbo.json'));
const ci = read('.github/workflows/ci.yml');
const lock = JSON.parse(read('package-lock.json'));
const pipeline = turbo.pipeline;

test('turbo.json keeps the turbo 1.x `pipeline` schema that matches the locked version', () => {
  assert.match(lock.packages['node_modules/turbo'].version, /^1\./);
  assert.ok(pipeline, 'turbo 1.x reads tasks from `pipeline`');
  assert.equal(turbo.tasks, undefined, '`tasks` is turbo 2.x syntax');
});

test('CI pins the exact turbo version from package-lock.json', () => {
  const pinned = ci.match(/^\s*TURBO_VERSION:\s*([\d.]+)\s*$/m)?.[1];
  assert.equal(pinned, lock.packages['node_modules/turbo'].version);
  for (const invocation of ci.match(/npx[^\n]*\bturbo\b[^\n]*/g) ?? []) {
    assert.match(invocation, /turbo@\$\{TURBO_VERSION\}/, `unpinned turbo call: ${invocation}`);
  }
});

test('remote cache artifacts are signed and CI wires credentials from secrets, never literals', () => {
  assert.equal(turbo.remoteCache?.signature, true);
  assert.match(ci, /TURBO_TOKEN:\s*\$\{\{\s*secrets\.TURBO_TOKEN\s*\}\}/);
  assert.match(ci, /TURBO_TEAM:\s*\$\{\{\s*vars\.TURBO_TEAM\s*\}\}/);
  assert.match(ci, /TURBO_REMOTE_CACHE_SIGNATURE_KEY:\s*\$\{\{\s*secrets\.TURBO_REMOTE_CACHE_SIGNATURE_KEY\s*\}\}/);
});

test('every task CI runs through turbo is defined in the pipeline', () => {
  const runs = [...ci.matchAll(/turbo@\$\{TURBO_VERSION\}\s+run\s+([^\n]+)/g)];
  assert.ok(runs.length > 0, 'CI should invoke turbo');
  for (const [, args] of runs) {
    const tasks = args.split(/\s+/).filter((arg) => arg && !arg.startsWith('-') && !arg.startsWith('>'));
    for (const task of tasks.filter((t) => !t.startsWith('/'))) {
      assert.ok(pipeline[task], `CI runs undefined turbo task "${task}"`);
    }
  }
});

test('matrix legs hash separately so Node 20 never replays a Node 22 build', () => {
  assert.ok(turbo.globalEnv.includes('NODE_VERSION'));
  assert.equal((ci.match(/NODE_VERSION:\s*\$\{\{\s*matrix\.node-version\s*\}\}/g) ?? []).length, 2);
});

test('build caches its outputs but never the Next.js incremental cache', () => {
  assert.deepEqual(pipeline.build.dependsOn, ['^build']);
  for (const output of ['dist/**', '.next/**', '!.next/cache/**']) {
    assert.ok(pipeline.build.outputs.includes(output), `missing build output ${output}`);
  }
  assert.ok(pipeline.build.env.includes('NEXT_PUBLIC_*'), 'public env is inlined into the bundle and must bust the cache');
});

test('test and lint only wait on upstream builds', () => {
  assert.deepEqual(pipeline.test.dependsOn, ['^build']);
  assert.deepEqual(pipeline.lint.dependsOn, ['^build']);
  assert.deepEqual(pipeline.test.outputs, ['coverage/**']);
});

test('dev is a persistent, uncached task', () => {
  assert.equal(pipeline.dev.cache, false);
  assert.equal(pipeline.dev.persistent, true);
});
