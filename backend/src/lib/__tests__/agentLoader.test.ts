import { describe, expect, it, vi } from 'vitest';
import { RequestScopedAgentLoader, type AgentCapability } from '../agentLoader.js';
import { agentContext, getAgentContext, type AgentRequest } from '../../middleware/agentContext.js';

const capabilities: readonly AgentCapability[] = [
  { id: 'pay', name: 'Pay', risk: 'low', costPerCall: 5 },
  { id: 'quote', name: 'Quote', risk: 'low' },
];

describe('RequestScopedAgentLoader', () => {
  it('shares one lookup across repeated calls in the same request', async () => {
    const load = vi.fn().mockResolvedValue(capabilities);
    const loader = new RequestScopedAgentLoader({ load }, vi.fn());
    const request = {};

    const [first, second] = await Promise.all([
      loader.load(request, 'agent-1'),
      loader.load(request, 'agent-1'),
    ]);

    expect(first).toBe(capabilities);
    expect(second).toBe(capabilities);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not share cached capabilities across requests', async () => {
    const load = vi.fn().mockResolvedValue(capabilities);
    const loader = new RequestScopedAgentLoader({ load }, vi.fn());

    await loader.load({}, 'agent-1');
    await loader.load({}, 'agent-1');

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('retries after a failed lookup', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValueOnce(capabilities);
    const loader = new RequestScopedAgentLoader({ load }, vi.fn());
    const request = {};

    await expect(loader.load(request, 'agent-1')).rejects.toThrow('rpc down');
    await expect(loader.load(request, 'agent-1')).resolves.toBe(capabilities);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('agentContext middleware', () => {
  it('exposes cached capabilities and an enforced token budget', async () => {
    const loader = new RequestScopedAgentLoader(
      { load: vi.fn().mockResolvedValue(capabilities) },
      vi.fn(),
    );
    const middleware = agentContext(loader, {
      agentIdOf: (req) => (req.agentId as string | undefined) ?? undefined,
      tokenLimit: 10,
    });
    const request: AgentRequest = { agentId: 'agent-1' };

    middleware(request, {}, () => undefined);
    const context = getAgentContext(request);

    expect(await context.capabilities()).toBe(capabilities);
    context.budget.spend(6);
    expect(context.budget.remaining).toBe(4);
    expect(() => context.budget.spend(5)).toThrow(/budget exceeded/);
  });
});
