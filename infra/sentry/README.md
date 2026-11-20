# Sentry

| File | Purpose |
| --- | --- |
| `alerting.yml` | Alert rules (error spikes, regressions, threat detection) |
| `dashboards.yml` | Frontend / backend error dashboards |
| `sourcemaps.json` | Which build outputs are uploaded as source maps, per Sentry project |
| `upload-sourcemaps.mjs` | Release-pipeline source-map uploader (tests: `upload-sourcemaps.test.mjs`) |

## Source maps in the release pipeline

Production bundles are minified, so without source maps Sentry shows frames
like `chunks/4821-3f9a.js:1:88213`. Every published release uploads the
matching source maps so issues show the original TypeScript file and line.

### How it works

`.github/workflows/release.yml`:

1. **`release` job** — semantic-release publishes `vX.Y.Z` (if there are
   releasable commits) and exposes `published` / `version` outputs.
2. **`sentry-sourcemaps` job** — runs only when a release was published:
   1. checks out the `vX.Y.Z` tag,
   2. builds the frontend with `SENTRY_RELEASE=agenticpay@X.Y.Z` and
      `SENTRY_AUTH_TOKEN` **unset**, so the `@sentry/nextjs` plugin emits hidden
      source maps and debug IDs but does not upload or delete them itself,
   3. runs `node infra/sentry/upload-sourcemaps.mjs --release X.Y.Z`, which:
      - fails if a configured build path is missing or contains no `.map` files,
      - `sentry-cli releases new agenticpay@X.Y.Z` for every target project,
      - `releases set-commits --auto` (best effort — see failure modes),
      - `sourcemaps inject` + `sourcemaps upload --wait` per target, retried
        3× with exponential backoff,
      - `releases finalize`.

Symbolication matches on **debug IDs** (a hash of each chunk's contents), so
the maps apply to any deployment of the same tag built with the same
environment. Deploy pipelines should build from the release tag and set
`SENTRY_RELEASE=agenticpay@X.Y.Z` so events are also grouped under the release.

Only the frontend is configured: the backend imports `@sentry/node` but does
not call `Sentry.init`, so it reports no events to symbolicate. To add a target,
append to `sourcemaps.json`:

```json
{ "name": "backend", "project": "agenticpay-backend", "paths": ["backend/dist"] }
```

and make sure the release job builds it with source maps enabled.

### Setup (repo admins)

| Setting | Where | Value |
| --- | --- | --- |
| `SENTRY_AUTH_TOKEN` | Actions **secret** | Organization token with `project:releases` and `org:read` |
| `SENTRY_ORG` | Actions **variable** (optional) | Org slug; defaults to `org` in `sourcemaps.json` |

If the secret is missing the job **skips with a warning** and a job-summary
note instead of failing the release.

### Observability

- The job summary lists, per target, the project, number of source maps and
  total size uploaded.
- Each target logs a structured line for log-based metrics:
  `{"event":"sentry.sourcemaps.uploaded","release":"agenticpay@X.Y.Z","target":"frontend","project":"agenticpay-frontend","maps":450,"bytes":…,"durationMs":…}`
- Failures and retries surface as GitHub `::error` / `::warning` annotations.
- In Sentry: **Settings → Projects → agenticpay-frontend → Source Maps →
  Artifact Bundles** lists each upload.

### Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Job skipped with warning | `SENTRY_AUTH_TOKEN` not set | Add the secret, then re-run the job |
| `build output … does not exist` | Build step failed or path in `sourcemaps.json` is wrong | Fix the build / path |
| `no .map files under …` | Maps disabled (`sourcemaps.disable`) or deleted by the plugin because a token leaked into the build env | Keep `SENTRY_AUTH_TOKEN: ''` on the build step |
| `associate commits failed` warning | Sentry GitHub integration not installed | Install it, or ignore — symbolication still works |
| `upload … failed` after 3 attempts | Sentry outage / invalid token scopes | Check the token scopes and [status.sentry.io](https://status.sentry.io), then re-run the job; the release stays unfinalized until it succeeds |
| Issues still show minified frames | Deployment was built from different code or env than the tag | Build deployments from the release tag with the same `NEXT_PUBLIC_*` and `SENTRY_RELEASE` values |

### Running locally

```bash
npm ci
(cd frontend && SENTRY_AUTH_TOKEN= npm run build)

# Validate the build and see what would be uploaded — no token needed:
node infra/sentry/upload-sourcemaps.mjs --release 1.2.3 --dry-run

# Tests (also run by `make test-tooling` and the CI tooling job):
node --test infra/sentry/upload-sourcemaps.test.mjs
```
