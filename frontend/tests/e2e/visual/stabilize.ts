import type { Page, Route } from '@playwright/test';
import {
  AUTH_STORAGE_KEY,
  buildAuthStorageValue,
  DEFAULT_TEST_USER,
} from '../../../e2e/helpers/test-data';

/** Every page starts its clock at this instant, so dates render identically. */
export const FROZEN_TIME = new Date('2026-01-15T10:00:00.000Z');

/** Backend responses keyed by API path (after `/api/v1`). Timestamps are fixed. */
export const API_FIXTURES: Record<string, unknown> = {
  '/webhooks/secrets': {
    secrets: [
      { id: 'whsec_stripe', provider: 'stripe', isActive: true, createdAt: '2025-11-02T09:00:00.000Z', lastUsedAt: '2026-01-14T18:30:00.000Z' },
      { id: 'whsec_github', provider: 'github', isActive: false, createdAt: '2025-08-21T12:00:00.000Z', expiresAt: '2026-02-01T00:00:00.000Z' },
    ],
    total: 2,
  },
  '/webhooks/events': {
    events: [
      { id: 'evt_1', provider: 'stripe', eventType: 'payment_intent.succeeded', payload: {}, signature: 'sig_1', timestamp: '2026-01-15T09:45:00.000Z', verified: true, processed: true, createdAt: '2026-01-15T09:45:00.000Z', processedAt: '2026-01-15T09:45:01.000Z', retryCount: 0 },
      { id: 'evt_2', provider: 'github', eventType: 'push', payload: {}, signature: 'sig_2', timestamp: '2026-01-15T08:12:00.000Z', verified: false, processed: false, createdAt: '2026-01-15T08:12:00.000Z', error: 'Signature mismatch', retryCount: 3 },
      { id: 'evt_3', provider: 'stripe', eventType: 'charge.refunded', payload: {}, signature: 'sig_3', timestamp: '2026-01-14T22:03:00.000Z', verified: true, processed: false, createdAt: '2026-01-14T22:03:00.000Z', retryCount: 1 },
    ],
    total: 3,
  },
};

export type BackendMode = 'fixtures' | 'down';

type StabilizeOptions = {
  /** The app under test; requests to any other origin are mocked or blocked. */
  baseURL: string;
  authenticated: boolean;
  /** `down` answers every backend call with 503 to snapshot error states. */
  backend?: BackendMode;
};

const API_PREFIX = '/api/v1';

/**
 * Makes a page render identically on every run:
 *  - starts the page clock at FROZEN_TIME. It keeps ticking: freezing it
 *    would also freeze JS-driven animations (recharts, framer-motion)
 *    mid-flight,
 *  - seeds (or not) the persisted auth session,
 *  - serves backend calls from API_FIXTURES — an unmocked endpoint fails the
 *    test instead of silently rendering whatever a dev backend returns,
 *  - blocks every other third-party request (fonts CDNs, wallets, analytics).
 * Animations, carets and toasts are neutralised at capture time by the
 * config's `toHaveScreenshot` options and `screenshot.css`.
 */
export async function stabilize(page: Page, { baseURL, authenticated, backend = 'fixtures' }: StabilizeOptions) {
  await page.clock.install({ time: FROZEN_TIME });

  if (authenticated) {
    await page.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, value),
      { key: AUTH_STORAGE_KEY, value: buildAuthStorageValue(DEFAULT_TEST_USER) },
    );
  }

  const appOrigin = new URL(baseURL).origin;
  const unmocked: string[] = [];

  await page.route(
    (url) => url.origin !== appOrigin,
    async (route: Route) => {
      const url = new URL(route.request().url());
      const apiIndex = url.pathname.indexOf(API_PREFIX);
      if (apiIndex === -1) return route.abort('blockedbyclient');

      if (backend === 'down') {
        return route.fulfill({ status: 503, json: { error: 'Service Unavailable' } });
      }
      const fixture = API_FIXTURES[url.pathname.slice(apiIndex + API_PREFIX.length)];
      if (fixture === undefined) {
        unmocked.push(`${route.request().method()} ${url.pathname}`);
        return route.fulfill({ status: 501, json: { error: `no visual fixture for ${url.pathname}` } });
      }
      return route.fulfill({ status: 200, json: fixture });
    },
  );

  return {
    /** Backend endpoints the page called that have no fixture. */
    unmockedRequests: () => [...unmocked],
  };
}

// Finite entrance animations still settle; looping ones (pulsing badges,
// spinners) are stopped after one cycle so they cannot keep the page "moving".
const SETTLE_STYLE = '*, *::before, *::after { animation-iteration-count: 1 !important; }';

/**
 * Waits until the page stops changing: two consecutive captures, taken with
 * animations running, are byte-identical. Entrance animations here are
 * JS-driven (framer-motion, recharts), so `toHaveScreenshot`'s own
 * `animations: 'disabled'` would freeze them mid-flight instead.
 */
export async function waitForSettled(page: Page, { timeout = 15_000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  let previous = await page.screenshot({ fullPage: true, style: SETTLE_STYLE, caret: 'hide' });
  while (Date.now() < deadline) {
    await page.waitForTimeout(interval);
    const current = await page.screenshot({ fullPage: true, style: SETTLE_STYLE, caret: 'hide' });
    if (current.equals(previous)) return;
    previous = current;
  }
  throw new Error(
    `page kept changing for ${timeout}ms — mask the animated region in routes.ts or wait for a later ready state`,
  );
}
