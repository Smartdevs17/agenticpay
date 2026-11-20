// Pins infra/sentry/upload-sourcemaps.mjs and its wiring in the release workflow.
// Runs offline: sentry-cli is replaced by a recording fake.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadConfig,
  parseArgs,
  planUpload,
  runUpload,
  SourcemapUploadError,
  summaryMarkdown,
  UPLOAD_ATTEMPTS,
} from './upload-sourcemaps.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..', '..');
const SCRIPT = join(here, 'upload-sourcemaps.mjs');
const TOKEN = 'sntrys_test-token-never-logged';

const config = {
  org: 'agenticpay',
  releasePrefix: 'agenticpay',
  targets: [{ name: 'frontend', project: 'agenticpay-frontend', paths: ['web/static', 'web/server'] }],
};

/** A fake build tree: `files` maps relative paths to contents. */
function fakeBuild(files = { 'web/static/app.js': 'x', 'web/static/app.js.map': '{}', 'web/server/page.js.map': '{}' }) {
  const root = mkdtempSync(join(tmpdir(), 'sentry-build-'));
  mkdirSync(join(root, 'web/static'), { recursive: true });
  mkdirSync(join(root, 'web/server'), { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

/** Records sentry-cli calls; `failures` maps a subcommand ('upload', ...) to how many times it fails first. */
function fakeCli(failures = {}) {
  const calls = [];
  const remaining = { ...failures };
  const exec = (args, { env }) => {
    calls.push({ args, env });
    const key = args[1];
    if (remaining[key] > 0) {
      remaining[key] -= 1;
      return { status: 1, stdout: '', stderr: `simulated ${key} failure` };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { exec, calls };
}

function recordingLog() {
  const lines = [];
  const push = (level) => (message) => lines.push({ level, message: message ?? '' });
  return {
    lines,
    log: { info: push('info'), warn: push('warn'), error: push('error'), group: push('group'), groupEnd: push('groupEnd') },
  };
}

const noSleep = async () => {};
const plan = (overrides = {}) =>
  planUpload({ config, version: '1.4.0', env: { SENTRY_AUTH_TOKEN: TOKEN }, root: fakeBuild(), ...overrides });

describe('planning', () => {
  test('names the release <prefix>@<version> and strips a leading v', () => {
    assert.equal(plan().release, 'agenticpay@1.4.0');
    assert.equal(plan({ version: 'v2.0.0-rc.1' }).release, 'agenticpay@2.0.0-rc.1');
  });

  test('rejects a non-semver version', () => {
    assert.throws(() => plan({ version: 'latest' }), /"latest" is not a semantic version/);
  });

  test('requires SENTRY_AUTH_TOKEN unless dry-running', () => {
    assert.throws(() => plan({ env: {} }), (error) => error instanceof SourcemapUploadError && /SENTRY_AUTH_TOKEN/.test(error.message));
    assert.doesNotThrow(() => plan({ env: {}, dryRun: true }));
  });

  test('SENTRY_ORG overrides the configured org', () => {
    assert.equal(plan({ env: { SENTRY_AUTH_TOKEN: TOKEN, SENTRY_ORG: 'other' } }).org, 'other');
  });

  test('counts source maps across all target paths', () => {
    const [target] = plan().targets;
    assert.equal(target.maps, 2);
    assert.equal(target.bytes, 4);
  });

  test('fails when a build path is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'sentry-empty-'));
    assert.throws(() => plan({ root }), /build output web\/static does not exist/);
  });

  test('fails when the build emitted no source maps', () => {
    assert.throws(() => plan({ root: fakeBuild({ 'web/static/app.js': 'x' }) }), /no \.map files/);
  });
});

describe('uploading', () => {
  test('creates, associates, injects, uploads and finalizes in order', async () => {
    const { exec, calls } = fakeCli();
    const p = plan();
    await runUpload(p, { exec, log: recordingLog().log, sleep: noSleep, env: { SENTRY_AUTH_TOKEN: TOKEN } });
    assert.deepEqual(
      calls.map((c) => c.args.slice(0, 2).join(' ')),
      ['releases new', 'releases set-commits', 'sourcemaps inject', 'sourcemaps upload', 'releases finalize'],
    );
    assert.deepEqual(calls[0].args, ['releases', 'new', 'agenticpay@1.4.0', '--project', 'agenticpay-frontend']);
    const upload = calls[3].args;
    assert.deepEqual(upload.slice(2, 7), ['--project', 'agenticpay-frontend', '--release', 'agenticpay@1.4.0', '--wait']);
    assert.deepEqual(upload.slice(7), p.targets[0].paths);
  });

  test('passes the token to sentry-cli via env only — never in args or logs', async () => {
    const { exec, calls } = fakeCli();
    const { log, lines } = recordingLog();
    await runUpload(plan(), { exec, log, sleep: noSleep, env: { SENTRY_AUTH_TOKEN: TOKEN } });
    for (const call of calls) {
      assert.equal(call.env.SENTRY_AUTH_TOKEN, TOKEN);
      assert.equal(call.env.SENTRY_ORG, 'agenticpay');
      assert.ok(!call.args.join(' ').includes(TOKEN));
    }
    assert.ok(!lines.some((l) => l.message.includes(TOKEN)));
  });

  test('commit association failure warns but does not fail the upload', async () => {
    const { exec, calls } = fakeCli({ 'set-commits': 1 });
    const { log, lines } = recordingLog();
    await runUpload(plan(), { exec, log, sleep: noSleep });
    assert.ok(lines.some((l) => l.level === 'warn' && /associate commits failed/.test(l.message)));
    assert.equal(calls.at(-1).args[1], 'finalize');
  });

  test('retries a flaky upload and then succeeds', async () => {
    const { exec, calls } = fakeCli({ upload: UPLOAD_ATTEMPTS - 1 });
    const { log, lines } = recordingLog();
    const delays = [];
    await runUpload(plan(), { exec, log, sleep: async (ms) => delays.push(ms) });
    assert.equal(calls.filter((c) => c.args[1] === 'upload').length, UPLOAD_ATTEMPTS);
    assert.deepEqual(delays, [2000, 4000]);
    assert.equal(lines.filter((l) => l.level === 'warn' && /retrying/.test(l.message)).length, UPLOAD_ATTEMPTS - 1);
  });

  test('gives up after the last attempt and leaves the release unfinalized', async () => {
    const { exec, calls } = fakeCli({ upload: UPLOAD_ATTEMPTS });
    await assert.rejects(
      runUpload(plan(), { exec, log: recordingLog().log, sleep: noSleep }),
      /upload frontend source maps failed \(exit 1\): simulated upload failure/,
    );
    assert.ok(!calls.some((c) => c.args[1] === 'finalize'));
  });

  test('fails fast when the release cannot be created', async () => {
    const { exec, calls } = fakeCli({ new: 1 });
    await assert.rejects(runUpload(plan(), { exec, log: recordingLog().log, sleep: noSleep }), /create release failed/);
    assert.equal(calls.length, 1);
  });

  test('emits a structured metric line per target', async () => {
    const { log, lines } = recordingLog();
    await runUpload(plan(), { exec: fakeCli().exec, log, sleep: noSleep });
    const metric = lines.map((l) => l.message).find((m) => m.includes('sentry.sourcemaps.uploaded'));
    assert.deepEqual(
      Object.keys(JSON.parse(metric)).sort(),
      ['bytes', 'durationMs', 'event', 'maps', 'project', 'release', 'target'],
    );
  });

  test('renders a job summary table', () => {
    const p = plan();
    const md = summaryMarkdown(p, undefined, { dryRun: true });
    assert.match(md, /Sentry source maps — `agenticpay@1\.4\.0` \(dry run/);
    assert.match(md, /\| frontend \| `agenticpay-frontend` \| 2 \|/);
  });
});

describe('CLI', () => {
  test('parses flags and rejects unknown ones', () => {
    assert.equal(parseArgs(['--release', '1.0.0', '--dry-run']).dryRun, true);
    assert.throws(() => parseArgs(['--release', '1.0.0', '--force']), /unknown argument: --force/);
    assert.throws(() => parseArgs([]), /missing --release/);
  });

  test('dry run validates the build and writes the step summary without uploading', () => {
    const root = fakeBuild();
    const configPath = join(root, 'sourcemaps.json');
    writeFileSync(
      configPath,
      JSON.stringify({ ...config, targets: [{ ...config.targets[0], paths: config.targets[0].paths.map((p) => join(root, p)) }] }),
    );
    const summary = join(root, 'summary.md');
    const result = spawnSync(process.execPath, [SCRIPT, '--release', '1.4.0', '--dry-run', '--config', configPath], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: summary },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /frontend: 2 source maps/);
    assert.match(readFileSync(summary, 'utf8'), /dry run, nothing uploaded/);
  });

  test('reports operator errors as a GitHub annotation and exits non-zero', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--release', '1.4.0'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error title=Sentry source maps::/);
  });

  test('the committed config is valid', () => {
    const committed = loadConfig(join(here, 'sourcemaps.json'));
    assert.deepEqual(committed.targets.map((t) => t.project), ['agenticpay-frontend']);
  });

  test('rejects a config without targets', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'sentry-cfg-')), 'c.json');
    writeFileSync(path, JSON.stringify({ releasePrefix: 'x', targets: [] }));
    assert.throws(() => loadConfig(path), /"targets" must list at least one target/);
  });
});

describe('release workflow wiring', () => {
  const workflow = readFileSync(join(repositoryRoot, '.github/workflows/release.yml'), 'utf8');

  test('exposes the published version from the release job', () => {
    assert.match(workflow, /published: \$\{\{ steps\.version\.outputs\.published \}\}/);
    assert.match(workflow, /version: \$\{\{ steps\.version\.outputs\.version \}\}/);
  });

  test('uploads only for a published release, from the release tag', () => {
    assert.match(workflow, /needs: release\s+if: needs\.release\.outputs\.published == 'true'/);
    assert.match(workflow, /ref: v\$\{\{ needs\.release\.outputs\.version \}\}/);
  });

  test('takes credentials from secrets and keeps them out of the build step', () => {
    assert.match(workflow, /SENTRY_AUTH_TOKEN: \$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}/);
    assert.doesNotMatch(workflow, /sntrys_|sntryu_/);
    // The Next.js plugin would otherwise upload (and delete) maps mid-build.
    assert.match(workflow, /Build frontend[\s\S]*?SENTRY_AUTH_TOKEN: ''/);
  });

  test('invokes the upload script with the published version', () => {
    assert.match(workflow, /node infra\/sentry\/upload-sourcemaps\.mjs --release "\$\{VERSION\}"/);
  });

  test('disables git hooks in CI so semantic-release commits are not re-linted', () => {
    assert.match(workflow, /HUSKY: '0'/);
  });
});
