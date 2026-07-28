import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiPaymentRouter, setFeatureStore, type ChainFeatures } from '../../services/routing/ai-router.js';

// Mock prisma so tests don't need a DB connection
vi.mock('../../lib/prisma.js', () => ({
  prisma: { routingDecision: { create: vi.fn().mockResolvedValue({}) } },
}));

const mockFeatures: ChainFeatures[] = [
  { chain: 'stellar', avgGasPrice: 0.00001, avgConfirmTimeMs: 5_000, successRate: 0.98, p99LatencyMs: 6_000 },
  { chain: 'evm',     avgGasPrice: 30,      avgConfirmTimeMs: 15_000, successRate: 0.94, p99LatencyMs: 20_000 },
];

beforeEach(() => {
  setFeatureStore({ getFeatures: async () => mockFeatures });
});

describe('AiPaymentRouter', () => {
  const router = new AiPaymentRouter();

  it('returns a selected chain', async () => {
    const result = await router.route({ amount: 100, fromAsset: 'XLM' });
    expect(['stellar', 'evm']).toContain(result.selectedChain);
  });

  it('selects stellar (lower cost) with cost preference', async () => {
    const result = await router.route({ amount: 100, fromAsset: 'XLM', preferCost: true });
    expect(result.selectedChain).toBe('stellar');
  });

  it('selects stellar (faster) with speed preference', async () => {
    const result = await router.route({ amount: 100, fromAsset: 'XLM', preferSpeed: true });
    expect(result.selectedChain).toBe('stellar');
  });

  it('respects manual override', async () => {
    const result = await router.route({
      amount: 100,
      fromAsset: 'XLM',
      manualOverride: { chain: 'evm', actor: 'admin@test.com' },
    });
    expect(result.selectedChain).toBe('evm');
    expect(result.rationale).toContain('Manual override');
  });

  it('includes fallback chains', async () => {
    const result = await router.route({ amount: 100, fromAsset: 'XLM' });
    expect(Array.isArray(result.fallbackChains)).toBe(true);
  });

  it('returns latencyMs under 50ms', async () => {
    const result = await router.route({ amount: 100, fromAsset: 'XLM' });
    expect(result.latencyMs).toBeLessThan(50);
  });

  it('throws when no features available', async () => {
    setFeatureStore({ getFeatures: async () => [] });
    await expect(router.route({ amount: 100, fromAsset: 'XLM' })).rejects.toThrow('No chain features');
    // restore
    setFeatureStore({ getFeatures: async () => mockFeatures });
  });

  it('includes scores for each chain', async () => {
    const result = await router.route({ amount: 100, fromAsset: 'XLM' });
    expect(result.scores).toHaveProperty('stellar');
    expect(result.scores).toHaveProperty('evm');
  });
});
