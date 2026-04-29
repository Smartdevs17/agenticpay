# End-to-end tests

End-to-end coverage for critical AgenticPay user flows, powered by
[Playwright](https://playwright.dev/). Tests live in this folder; configuration
is in [`../playwright.config.ts`](../playwright.config.ts).

## What's covered

- **Landing page** — hero, features, CTAs (`landing.spec.ts`)
- **Authentication surface** — tabs, providers, copy (`auth.spec.ts`)
- **Dashboard** — auth redirect, sidebar navigation, active state (`dashboard.spec.ts`)
- **Payment routing** — sidebar entry point and auth gating (`payment.spec.ts`)
- **Visual regression** — snapshots for landing and auth (`visual.spec.ts`)

Tests run against Chromium, Firefox, WebKit, plus Pixel 7 and iPhone 14 mobile
viewports.

## Running locally

From the `frontend/` directory:

```bash
# One-time: install browser binaries
npm run test:e2e:install

# Run the full suite headless
npm run test:e2e

# Run a single file / browser
npx playwright test e2e/auth.spec.ts --project=chromium

# Interactive UI mode (watch + time-travel debugger)
npm run test:e2e:ui

# Regenerate visual snapshots
npm run test:e2e:update-snapshots

# Open the last HTML report
npm run test:e2e:report
```

The Playwright config starts Next.js via `next dev` on port `3100`
(override with `PLAYWRIGHT_PORT` / `PLAYWRIGHT_BASE_URL`).

## Authentication fixture

The app persists auth through a Zustand store backed by `localStorage` under
the `agenticpay-auth` key. Tests that need an authenticated session use the
`authenticatedPage` fixture from `fixtures.ts`, which seeds that key via
`page.addInitScript` before the first navigation.

```ts
import { test, expect } from './fixtures';

test('example', async ({ authenticatedPage: page }) => {
  await page.goto('/dashboard');
  // page starts authenticated as DEFAULT_TEST_USER
});
```

To seed a custom user, pull in the lower-level `seedAuth` helper:

```ts
test('custom user', async ({ seedAuth, page }) => {
  await seedAuth({ ...DEFAULT_TEST_USER, name: 'Alternate' });
  await page.goto('/dashboard');
});
```

## Visual regression

Snapshots live under `e2e/__snapshots__/` and are keyed per browser project.
Update them intentionally (`test:e2e:update-snapshots`) and review diffs in
the HTML report.

## CI

The `e2e.yml` workflow shards the suite across the browser projects and uploads
the HTML report plus failure traces/videos as workflow artifacts.
