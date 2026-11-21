import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRaw = vi.fn(async () => [
  { id: 'p1', tenantId: 't1', projectTitle: 'Website redesign', currency: 'XLM', network: 'stellar', status: 'completed', amount: '10', txHash: null, createdAt: new Date(), rank: 0.5, headline: 'Website' },
]);

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: queryRaw,
  },
}));

import { searchPayments } from '../payment-search.service.js';

describe('payment-search.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty array for a blank query without hitting the database', async () => {
    const results = await searchPayments('   ');
    expect(results).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('runs a full-text search query and returns ranked results', async () => {
    const results = await searchPayments('website');
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'p1', projectTitle: 'Website redesign' });
  });
});
