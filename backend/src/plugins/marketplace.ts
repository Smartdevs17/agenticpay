export type MarketplaceCategory = 'automation' | 'communication' | 'developer-tools' | 'support';

export interface MarketplaceApp {
  id: string;
  name: string;
  description: string;
  category: MarketplaceCategory;
  version: string;
  publisher: string;
  source: string;
  compatibility: { agenticPay: string };
  tags: string[];
  verified: boolean;
}

const CORE_VERSION = process.env.AGENTICPAY_VERSION ?? '0.1.0';

const BUILT_IN_APPS: readonly MarketplaceApp[] = [
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send payment and workflow notifications to Slack channels.',
    category: 'communication',
    version: '1.0.0',
    publisher: 'AgenticPay',
    source: 'builtin:slack',
    compatibility: { agenticPay: `^${CORE_VERSION}` },
    tags: ['alerts', 'chat', 'notifications'],
    verified: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Connect repository events to AgenticPay workflows.',
    category: 'developer-tools',
    version: '1.0.0',
    publisher: 'AgenticPay',
    source: 'builtin:github',
    compatibility: { agenticPay: `^${CORE_VERSION}` },
    tags: ['git', 'repositories', 'webhooks'],
    verified: true,
  },
  {
    id: 'zapier',
    name: 'Zapier',
    description: 'Automate AgenticPay actions across thousands of applications.',
    category: 'automation',
    version: '1.0.0',
    publisher: 'AgenticPay',
    source: 'builtin:zapier',
    compatibility: { agenticPay: `^${CORE_VERSION}` },
    tags: ['automation', 'workflows'],
    verified: true,
  },
  {
    id: 'intercom',
    name: 'Intercom',
    description: 'Surface payment context in customer support conversations.',
    category: 'support',
    version: '1.0.0',
    publisher: 'AgenticPay',
    source: 'builtin:intercom',
    compatibility: { agenticPay: `^${CORE_VERSION}` },
    tags: ['customers', 'support'],
    verified: true,
  },
];

export interface MarketplaceFilters {
  query?: string;
  category?: string;
}

export function listMarketplaceApps(filters: MarketplaceFilters = {}): MarketplaceApp[] {
  const query = filters.query?.trim().toLowerCase();
  const category = filters.category?.trim().toLowerCase();

  return BUILT_IN_APPS.filter((app) => {
    if (category && app.category !== category) return false;
    if (!query) return true;

    const searchable = [app.name, app.description, app.publisher, ...app.tags].join(' ').toLowerCase();
    return searchable.includes(query);
  }).map((app) => ({
    ...app,
    tags: [...app.tags],
    compatibility: { ...app.compatibility },
  }));
}

export function marketplaceCategories(): MarketplaceCategory[] {
  return [...new Set(BUILT_IN_APPS.map((app) => app.category))].sort();
}
