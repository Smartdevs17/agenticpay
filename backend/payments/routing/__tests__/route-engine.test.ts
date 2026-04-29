import { calculateOptimalRoute, executeWithFallback } from '../route-engine';
import { NetworkMetrics, UserPreferences, NetworkId } from '../types';

const mockMetrics = (id: NetworkId, gasPrice: number, blockTime: number): NetworkMetrics => ({
  networkId: id,
  gasPriceGwei: gasPrice,
  blockTimeSeconds: blockTime,
  reliabilityScore: 98,
  congestionLevel: 'low',
  lastBlockTimestamp: Date.now(),
  failedTxCount24h: 5,
  totalTxCount24h: 50000,
});

describe('route-engine', () => {
  it('selects cheapest network with cost priority', async () => {
    const metrics = [
      mockMetrics('ethereum', 50, 12),
      mockMetrics('arbitrum', 0.5, 0.25),
      mockMetrics('polygon', 100, 2),
    ];

    const route = await calculateOptimalRoute(
      { amountUsd: 100, fromAddress: '0x1', toAddress: '0x2' },
      { priority: 'cost' },
      metrics
    );

    expect(route.recommended).toBe('arbitrum');
    expect(route.primary).toBe('arbitrum');
  });

  it('selects fastest network with speed priority', async () => {
    const metrics = [
      mockMetrics('ethereum', 25, 12),
      mockMetrics('arbitrum', 0.5, 0.25),
      mockMetrics('optimism', 0.3, 2),
    ];

    const route = await calculateOptimalRoute(
      { amountUsd: 100, fromAddress: '0x1', toAddress: '0x2' },
      { priority: 'speed' },
      metrics
    );

    expect(route.recommended).toBe('arbitrum');
  });

  it('provides fallbacks', async () => {
    const metrics = [
      mockMetrics('ethereum', 25, 12),
      mockMetrics('polygon', 50, 2),
      mockMetrics('arbitrum', 0.5, 0.25),
    ];

    const route = await calculateOptimalRoute(
      { amountUsd: 100, fromAddress: '0x1', toAddress: '0x2' },
      { priority: 'cost' },
      metrics
    );

    expect(route.fallbacks.length).toBeGreaterThan(0);
    expect(route.fallbacks).not.toContain(route.primary);
  });

  it('respects max fee constraint', async () => {
    const metrics = [
      mockMetrics('ethereum', 500, 12), // Expensive
      mockMetrics('arbitrum', 0.5, 0.25), // Cheap
    ];

    const route = await calculateOptimalRoute(
      { amountUsd: 100, fromAddress: '0x1', toAddress: '0x2' },
      { priority: 'cost', maxFeeUsd: 1 },
      metrics
    );

    expect(route.primary).toBe('arbitrum');
  });

  it('respects excluded networks', async () => {
    const metrics = [
      mockMetrics('ethereum', 25, 12),
      mockMetrics('polygon', 50, 2),
    ];

    const route = await calculateOptimalRoute(
      { amountUsd: 100, fromAddress: '0x1', toAddress: '0x2' },
      { priority: 'cost', excludedNetworks: ['polygon'] },
      metrics
    );

    expect(route.primary).toBe('ethereum');
    expect(route.fallbacks).not.toContain('polygon');
  });

  it('executes with fallback on failure', async () => {
    const executeFn = jest.fn()
      .mockRejectedValueOnce(new Error('Network congestion'))
      .mockResolvedValueOnce('0xabc123');

    const result = await executeWithFallback(
      {
        primary: 'ethereum',
        fallbacks: ['arbitrum'],
        bridgeRequired: false,
        scores: {} as Record<NetworkId, any>,
        recommended: 'ethereum',
        userOverridden: false,
      },
      executeFn
    );

    expect(result.txHash).toBe('0xabc123');
    expect(result.networkUsed).toBe('arbitrum');
    expect(result.attempts).toBe(2);
    expect(executeFn).toHaveBeenCalledTimes(2);
  });

  it('throws when all networks fail', async () => {
    const executeFn = jest.fn().mockRejectedValue(new Error('Failed'));

    await expect(
      executeWithFallback(
        {
          primary: 'ethereum',
          fallbacks: ['polygon'],
          bridgeRequired: false,
          scores: {} as Record<NetworkId, any>,
          recommended: 'ethereum',
          userOverridden: false,
        },
        executeFn
      )
    ).rejects.toThrow('All routing attempts failed');
  });
});