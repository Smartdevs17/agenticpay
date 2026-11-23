import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgenticPayClient } from '../client.js';
import { FeatureFlagsApi } from '../featureFlags.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FeatureFlagsApi (#1354)', () => {
  const client = new AgenticPayClient({ baseUrl: 'http://localhost:3001/api/v1' });
  const api = new FeatureFlagsApi(client);

  it('uses the mounted /flags endpoints', async () => {
    const get = vi.spyOn(client, 'get').mockResolvedValue({
      flag: 'checkout',
      identifier: 'user-1',
      enabled: true,
    });
    const post = vi.spyOn(client, 'post').mockResolvedValue({ recorded: true });

    await api.evaluate('checkout', 'user-1');
    expect(get).toHaveBeenCalledWith('/flags/evaluate?flag=checkout&identifier=user-1');

    await api.state('user-1');
    expect(get).toHaveBeenCalledWith('/flags/state?identifier=user-1');

    await api.recordExposure('checkout', 'user-1', 'treatment');
    expect(post).toHaveBeenCalledWith('/flags/exposure', {
      flag: 'checkout',
      identifier: 'user-1',
      value: 'treatment',
    });
  });

  it('requests cohort data from the evaluate endpoint', async () => {
    const get = vi.spyOn(client, 'get').mockResolvedValue({
      flag: 'checkout',
      identifier: 'user-1',
      enabled: true,
      variant: 'treatment',
      cohortId: 'beta',
    });

    const result = await api.evaluateWithCohort('checkout', 'user-1');

    expect(get).toHaveBeenCalledWith(
      '/flags/evaluate?flag=checkout&identifier=user-1&includeCohort=true'
    );
    expect(result.cohortId).toBe('beta');
    expect(result.variant).toBe('treatment');
  });
});
