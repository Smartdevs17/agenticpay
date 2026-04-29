import { scoreNetwork, scoreAllNetworks } from '../scoring-engine';
import { NetworkMetrics, UserPreferences, NetworkId } from '../types';

const mockMetrics = (overrides: Partial<NetworkMetrics> = {}): NetworkMetrics => ({
  networkId: 'ethereum' as NetworkId,
  gasPriceGwei: 25,
  blockTimeSeconds: 12,
  reliabilityScore: 99,
  congestionLevel: 'low',
  lastBlockTimestamp: Date.now(),
  failedTxCount24h: 10,
  totalTxCount24h: 100000,
  ...overrides,
});

describe('scoring-engine', () => {
  it('scores network with cost priority', () => {
    const metrics = mockMetrics({ networkId: 'ethereum', gasPriceGwei: 20 });
    const prefs: UserPreferences = { priority: 'cost' };
    const score = scoreNetwork(metrics, prefs);

    expect(score.networkId).toBe('ethereum');
    expect(score.compositeScore).toBeGreaterThan(0);
    expect(score.estimatedFeeUsd).toBeGreaterThan(0);
    expect(score.estimatedTimeSeconds).toBe(24);
  });

  it('scores network with speed priority', () => {
    const metrics = mockMetrics({ networkId: 'arbitrum', gasPriceGwei: 0.1, blockTimeSeconds: 0.25 });
    const prefs: UserPreferences = { priority: 'speed' };
    const score = scoreNetwork(metrics, prefs);

    expect(score.estimatedTimeSeconds).toBe(0.5);
    expect(score.speedScore).toBeLessThan(scoreAllNetworks([mockMetrics({ networkId: 'ethereum' })], prefs)[0].speedScore);
  });

  it('penalizes high congestion', () => {
    const lowCongestion = mockMetrics({ congestionLevel: 'low', reliabilityScore: 99 });
    const criticalCongestion = mockMetrics({ congestionLevel: 'critical', reliabilityScore: 99 });

    const prefs: UserPreferences = { priority: 'reliability' };
    const lowScore = scoreNetwork(lowCongestion, prefs);
    const critScore = scoreNetwork(criticalCongestion, prefs);

    expect(lowScore.reliabilityScore).toBeGreaterThan(critScore.reliabilityScore);
  });

  it('sorts all networks by composite score', () => {
    const metrics: NetworkMetrics[] = [
      mockMetrics({ networkId: 'ethereum', gasPriceGwei: 50 }),
      mockMetrics({ networkId: 'polygon', gasPriceGwei: 100 }),
      mockMetrics({ networkId: 'arbitrum', gasPriceGwei: 0.1, blockTimeSeconds: 0.25 }),
    ];

    const prefs: UserPreferences = { priority: 'cost' };
    const scores = scoreAllNetworks(metrics, prefs);

    expect(scores[0].networkId).toBe('arbitrum'); // Cheapest
    expect(scores).toHaveLength(3);
    expect(scores[0].compositeScore).toBeLessThanOrEqual(scores[1].compositeScore);
  });
});