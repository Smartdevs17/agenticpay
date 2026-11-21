import { describe, expect, it } from 'vitest';
import { listMarketplaceApps, marketplaceCategories } from './marketplace.js';

describe('marketplace app directory', () => {
  it('lists the built-in integrations with install metadata', () => {
    const apps = listMarketplaceApps();

    expect(apps).toHaveLength(4);
    expect(apps.every((app) => app.source.startsWith('builtin:'))).toBe(true);
    expect(apps.every((app) => app.compatibility.agenticPay)).toBe(true);
    expect(marketplaceCategories()).toEqual(['automation', 'communication', 'developer-tools', 'support']);
  });

  it('filters by category and free-text query', () => {
    expect(listMarketplaceApps({ category: 'support' }).map((app) => app.id)).toEqual(['intercom']);
    expect(listMarketplaceApps({ query: 'REPOSITORIES' }).map((app) => app.id)).toEqual(['github']);
  });

  it('returns an empty directory when no app matches', () => {
    expect(listMarketplaceApps({ query: 'not-an-integration' })).toEqual([]);
  });
});
