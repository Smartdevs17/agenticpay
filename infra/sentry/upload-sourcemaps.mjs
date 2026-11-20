#!/usr/bin/env node
// Uploads production source maps to Sentry for a published release.
//
//   node infra/sentry/upload-sourcemaps.mjs --release 1.4.0 [--dry-run]
//
// For the release `<releasePrefix>@<version>` it:
//   1. checks every configured build path exists and contains source maps,
//   2. creates the Sentry release for all target projects,
//   3. associates commits (best effort — needs the Sentry GitHub integration),
//   4. injects debug IDs and uploads each target's maps (retried on failure),
//   5. finalizes the release.
//
// Environment:
//   SENTRY_AUTH_TOKEN    required unless --dry-run; read by sentry-cli, never logged
//   SENTRY_ORG           overrides `org` from the config
//   SENTRY_URL           self-hosted Sentry base URL (optional)
//   GITHUB_STEP_SUMMARY  when set, a markdown summary is appended to it
//
// Targets live in infra/sentry/sourcemaps.json. Behaviour is pinned by
// infra/sentry/upload-sourcemaps.test.mjs; see infra/sentry/README.md.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_CONFIG = join(REPO_ROOT, 'infra', 'sentry', 'sourcemaps.json');
const SENTRY_CLI = join(REPO_ROOT, 'node_modules', '.bin', 'sentry-cli');
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const UPLOAD_ATTEMPTS = 3;

/** An error the operator can fix (bad input, missing build, missing secret). */
export class SourcemapUploadError extends Error {}

export function parseArgs(argv) {
  const args = { dryRun: false, config: DEFAULT_CONFIG, release: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--release') args.release = argv[(i += 1)];
    else if (arg === '--config') args.config = resolve(argv[(i += 1)]);
    else throw new SourcemapUploadError(`unknown argument: ${arg}`);
  }
  if (!args.release) throw new SourcemapUploadError('missing --release <version>');
  return args;
}

export function loadConfig(path) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof config.releasePrefix !== 'string' || !config.releasePrefix) {
    throw new SourcemapUploadError(`${path}: "releasePrefix" must be a non-empty string`);
  }
  if (!Array.isArray(config.targets) || config.targets.length === 0) {
    throw new SourcemapUploadError(`${path}: "targets" must list at least one target`);
  }
  for (const target of config.targets) {
    if (!target.name || !target.project || !Array.isArray(target.paths) || target.paths.length === 0) {
      throw new SourcemapUploadError(
        `${path}: every target needs "name", "project" and a non-empty "paths" array`,
      );
    }
  }
  return config;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** Counts the source maps under `paths`, failing loudly if the build is missing or map-less. */
export function inspectBuild(target, root) {
  let maps = 0;
  let bytes = 0;
  for (const path of target.paths) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) {
      throw new SourcemapUploadError(
        `${target.name}: build output ${path} does not exist — build the ${target.name} before uploading`,
      );
    }
    for (const file of walk(absolute)) {
      if (file.endsWith('.map')) {
        maps += 1;
        bytes += statSync(file).size;
      }
    }
  }
  if (maps === 0) {
    throw new SourcemapUploadError(
      `${target.name}: no .map files under ${target.paths.join(', ')} — the build did not emit source maps ` +
        '(check `sourcemaps.disable` / `deleteSourcemapsAfterUpload` in withSentryConfig and that SENTRY_AUTH_TOKEN was unset during the build)',
    );
  }
  return { maps, bytes };
}

/** Pure description of what will be uploaded; no side effects besides reading the build. */
export function planUpload({ config, version, env = process.env, root = REPO_ROOT, dryRun = false }) {
  const normalized = String(version).replace(/^v/, '');
  if (!VERSION_PATTERN.test(normalized)) {
    throw new SourcemapUploadError(`"${version}" is not a semantic version`);
  }
  if (!dryRun && !env.SENTRY_AUTH_TOKEN) {
    throw new SourcemapUploadError(
      'SENTRY_AUTH_TOKEN is not set — add it as a repository secret (scopes: project:releases, org:read)',
    );
  }
  const org = env.SENTRY_ORG || config.org;
  if (!org) throw new SourcemapUploadError('no Sentry org — set SENTRY_ORG or "org" in the config');

  return {
    org,
    release: `${config.releasePrefix}@${normalized}`,
    root,
    targets: config.targets.map((target) => ({
      ...target,
      paths: target.paths.map((path) => resolve(root, path)),
      ...inspectBuild(target, root),
    })),
  };
}

export function defaultExec(args, { env }) {
  const result = spawnSync(SENTRY_CLI, args, { cwd: REPO_ROOT, env, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const consoleLog = {
  info: (message) => console.log(message),
  warn: (message) => console.log(`::warning title=Sentry source maps::${message}`),
  error: (message) => console.log(`::error title=Sentry source maps::${message}`),
  group: (title) => console.log(`::group::${title}`),
  groupEnd: () => console.log('::endgroup::'),
};

/**
 * Executes the plan with sentry-cli. `exec`, `log` and `sleep` are injectable
 * for tests. Returns a per-target report; throws if any upload ultimately fails.
 */
export async function runUpload(
  plan,
  { exec = defaultExec, log = consoleLog, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), env = process.env } = {},
) {
  const cliEnv = { ...env, SENTRY_ORG: plan.org };
  const projects = plan.targets.flatMap((target) => ['--project', target.project]);
  const cli = (label, args) => {
    log.info(`$ sentry-cli ${args.join(' ')}`);
    const result = exec(args, { env: cliEnv });
    if (result.status !== 0) {
      const detail = `${result.stderr || result.stdout || ''}`.trim();
      throw new SourcemapUploadError(`${label} failed (exit ${result.status})${detail ? `: ${detail}` : ''}`);
    }
    return result;
  };

  cli('create release', ['releases', 'new', plan.release, ...projects]);

  try {
    cli('associate commits', ['releases', 'set-commits', plan.release, '--auto', '--ignore-missing']);
  } catch (error) {
    // Commonly fails when the Sentry GitHub integration is not installed.
    // Stack traces still symbolicate, so this must not fail the release.
    log.warn(`${error.message} — continuing without commit association`);
  }

  const report = [];
  for (const target of plan.targets) {
    const started = Date.now();
    log.group(`${target.name} → ${target.project} (${target.maps} source maps)`);
    try {
      cli(`inject debug IDs for ${target.name}`, ['sourcemaps', 'inject', ...target.paths]);
      const uploadArgs = [
        'sourcemaps', 'upload',
        '--project', target.project,
        '--release', plan.release,
        '--wait',
        ...target.paths,
      ];
      for (let attempt = 1; ; attempt += 1) {
        try {
          cli(`upload ${target.name} source maps`, uploadArgs);
          break;
        } catch (error) {
          if (attempt >= UPLOAD_ATTEMPTS) throw error;
          log.warn(`${error.message} — retrying (${attempt}/${UPLOAD_ATTEMPTS})`);
          await sleep(2 ** attempt * 1000);
        }
      }
    } finally {
      log.groupEnd();
    }
    const entry = {
      target: target.name,
      project: target.project,
      maps: target.maps,
      bytes: target.bytes,
      durationMs: Date.now() - started,
    };
    report.push(entry);
    // Structured line for log-based metrics/alerting.
    log.info(JSON.stringify({ event: 'sentry.sourcemaps.uploaded', release: plan.release, ...entry }));
  }

  cli('finalize release', ['releases', 'finalize', plan.release]);
  return report;
}

export function summaryMarkdown(plan, report, { dryRun = false } = {}) {
  const rows = (report ?? plan.targets.map((t) => ({ target: t.name, project: t.project, maps: t.maps, bytes: t.bytes })))
    .map((r) => `| ${r.target} | \`${r.project}\` | ${r.maps} | ${(r.bytes / 1024 / 1024).toFixed(1)} MB |`);
  return [
    `### Sentry source maps — \`${plan.release}\`${dryRun ? ' (dry run, nothing uploaded)' : ''}`,
    '',
    '| Target | Project | Source maps | Size |',
    '| --- | --- | ---: | ---: |',
    ...rows,
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  const plan = planUpload({ config, version: args.release, dryRun: args.dryRun });

  for (const target of plan.targets) {
    consoleLog.info(
      `${target.name}: ${target.maps} source maps in ${target.paths.map((p) => relative(REPO_ROOT, p)).join(', ')}`,
    );
  }

  const report = args.dryRun ? undefined : await runUpload(plan);
  const summary = summaryMarkdown(plan, report, { dryRun: args.dryRun });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  consoleLog.info(args.dryRun ? `dry run: would upload to ${plan.release}` : `uploaded source maps for ${plan.release}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    consoleLog.error(error.message);
    process.exitCode = 1;
  });
}
