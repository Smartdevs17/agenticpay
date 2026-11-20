import type { Locator, Page } from '@playwright/test';

export type VisualRoute = {
  /** Snapshot file stem — renaming it orphans the committed baseline. */
  name: string;
  path: string;
  /** Seed a signed-in session before navigating. */
  authenticated: boolean;
  /** Resolves once the page's primary content (not a loading state) is visible. */
  ready: (page: Page) => Locator;
  /** Regions whose pixels are not under test (live data, third-party widgets). */
  mask?: (page: Page) => Locator[];
};

/**
 * Pages covered by visual regression. Each gets a desktop and a mobile
 * baseline under `__screenshots__/`. Adding a route here and running
 * `npm run test:visual:update` is all that is needed to cover a new page.
 */
export const VISUAL_ROUTES: VisualRoute[] = [
  {
    name: 'dashboard-overview',
    path: '/dashboard',
    authenticated: true,
    ready: (page) => page.getByRole('main').getByRole('heading', { level: 1 }).first(),
  },
  {
    name: 'dashboard-projects',
    path: '/dashboard/projects',
    authenticated: true,
    // Projects are read from the connected wallet; the seeded session has none.
    ready: (page) => page.getByRole('heading', { name: /connect your wallet/i }),
  },
  {
    name: 'dashboard-invoices',
    path: '/dashboard/invoices',
    authenticated: true,
    ready: (page) => page.getByRole('main').getByRole('heading', { level: 1 }).first(),
  },
  {
    name: 'dashboard-payments',
    path: '/dashboard/payments',
    authenticated: true,
    ready: (page) => page.getByRole('main').getByRole('heading', { level: 1 }).first(),
  },
  {
    name: 'dashboard-escrow',
    path: '/dashboard/escrow',
    authenticated: true,
    ready: (page) => page.getByRole('main').getByRole('heading', { level: 1 }).first(),
  },
  {
    name: 'dashboard-disputes',
    path: '/dashboard/disputes',
    authenticated: true,
    ready: (page) => page.getByRole('main').getByRole('heading', { level: 1 }).first(),
  },
  {
    name: 'dashboard-webhooks',
    path: '/dashboard/webhooks',
    authenticated: true,
    // Rendered from API_FIXTURES, so this proves the fixture data loaded.
    ready: (page) => page.getByText('payment_intent.succeeded'),
  },
  {
    name: 'auth',
    path: '/auth',
    authenticated: false,
    ready: (page) => page.getByRole('heading', { name: /Welcome to AgenticPay/i }),
  },
];
