# Dashboard visual regression

Pixel-level snapshots of the dashboard, compared on every PR that touches
`frontend/`. A layout, styling or copy change shows up as a failing test with
an expected / actual / diff view, before it reaches users.

| File | Purpose |
| --- | --- |
| `routes.ts` | Pages under test and how to tell each one has finished loading |
| `dashboard.visual.spec.ts` | One snapshot per route × project, plus failure-state tests |
| `stabilize.ts` | Determinism: fixed clock, seeded session, API fixtures, settle wait |
| `screenshot.css` | Applied only at capture: hides random toasts, un-clips the scrolling shell |
| `playwright.config.ts` | Production build, `desktop` (1280×800) and `mobile` (Pixel 7) projects |
| `run.sh` / `docker.sh` | Install → build → test inside the CI Playwright image |
| `__screenshots__/<project>/` | Committed baselines |

## Running it

Baselines are rendered on Linux (`mcr.microsoft.com/playwright`, amd64). Fonts
render differently on macOS and Windows, so run the suite in Docker:

```bash
cd frontend

npm run test:visual:docker                          # compare with baselines
npm run test:visual:docker -- -g dashboard-overview # one page
npm run test:visual:docker -- --update-snapshots    # re-record after an intended change
npx playwright show-report playwright-report/visual # inspect diffs
```

The first run pulls the image and installs dependencies (several minutes);
later runs reuse the npm cache volume.

Building inside the container needs ~6 GB of Docker memory (Docker Desktop
defaults to 4 GB, where `next build` is OOM-killed). With less, serve the
production build from the host and only render in the container — the pixels
come from the container's browser and fonts, so baselines are identical:

```bash
npm run build && npm run start -- --port 3300 &
VISUAL_BASE_URL=http://host.docker.internal:3300 npm run test:visual:docker
``` Your host `node_modules` and `.next`
are never touched — the tree is copied into the container and only
`__screenshots__/`, `playwright-report/` and `test-results/` are mounted back.

On Linux you can also run `npm run test:visual` directly. On other hosts the
config refuses to run (every snapshot would fail on font rendering) unless
`VISUAL_ALLOW_HOST=1` is set, which is useful for debugging a test's flow but
not for comparing pixels.

### In CI

The `Visual regression` job in `.github/workflows/e2e.yml` runs `run.sh` in
the same image. On failure the job summary lists the failing snapshots and the
**visual-report** artifact holds the HTML report with diffs. To re-record
without Docker, run the **E2E** workflow manually with
*update_visual_snapshots* checked and commit the **visual-baselines** artifact.

## When a snapshot fails

1. Open the report and look at the diff.
2. **Unintended** — fix the regression.
3. **Intended** — re-record with `--update-snapshots`, review the new PNGs in
   the PR diff, and commit them with the change that caused them.

Comparison is strict (`maxDiffPixels: 0`; `threshold` only absorbs
anti-aliasing), so even a changed table cell fails. That is only reliable
because baselines and CI share one image — never commit baselines recorded on
a host OS.

## How determinism is achieved

- **Production build** via `next start`: no dev overlay or on-demand compiling.
  The server is not bound with `--hostname 127.0.0.1`; that makes the
  next-intl middleware rewrite to `localhost`, which Next proxies back through
  the middleware into a redirect loop.
- **Clock** starts at `2026-01-15T10:00:00Z` and keeps ticking, so dates are
  stable while JS-driven animations (recharts, framer-motion) still finish.
- **Session** is seeded into `localStorage` for dashboard routes.
- **Backend** calls are answered from `API_FIXTURES`. A call with no fixture
  returns 501 *and* fails the test, so a new endpoint can't silently render a
  broken state into a baseline. Every other third-party request is blocked —
  including Google Fonts, so text renders in the image's fallback font. That
  keeps runs offline-safe; layout and copy regressions are still caught.
- **Settle wait**: `waitForSettled` captures until two consecutive frames
  match with animations running. Playwright's `animations: 'disabled'` alone
  would freeze JS-driven entrance animations mid-flight.
- **Capture-time CSS** hides the demo notification toasts (random, every 10s)
  and lets the dashboard shell grow so `fullPage` includes content below the
  fold.

## Covered states

- Each route in `routes.ts`, signed in, on desktop and mobile. Every snapshot
  also asserts the hard-loaded URL did not bounce to `/auth`.
- Signed-out visit to `/dashboard` lands on sign-in.
- Webhooks page with the backend returning 503: error toast shown, empty
  tables snapshotted.

`/dashboard/projects` reads projects from a connected wallet, which the seeded
session does not have, so its baseline is the "connect your wallet" state.

## Adding a page

1. Add an entry to `VISUAL_ROUTES` with a `ready` locator for the loaded state
   (not a spinner).
2. If the page calls the backend, add fixtures to `API_FIXTURES`.
3. Mask regions that are inherently live (`mask: (page) => [...]`).
4. `npm run test:visual:docker -- --update-snapshots -g <name>` and commit the
   new PNGs.
