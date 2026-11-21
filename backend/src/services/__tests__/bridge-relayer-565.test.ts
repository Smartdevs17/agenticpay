import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { BridgeRelayerService } from '../bridge-relayer.js';

describe('Bridge Relayer Service (#565)', () => {
  let relayer: BridgeRelayerService;

  beforeEach(() => {
    relayer = new BridgeRelayerService();
  });

  afterEach(() => {
    relayer.stop();
  });

  it('initiates a cross-chain swap', async () => {
    const swap = await relayer.initiateSwap({
      sourceChain: 'stellar',
      destinationChain: 'evm',
      sourceLockId: 'lock-1',
      sender: 'stellar-addr-1',
      recipient: 'evm-addr-1',
      amount: '1000',
      hashlock: '0xabc123',
      timelockSource: Date.now() + 3600000,
      timelockDestination: Date.now() + 3600000,
    });

    expect(swap.id).toMatch(/^swap_/);
    expect(swap.status).toBe('initiated');
    expect(swap.sourceChain).toBe('stellar');
    expect(swap.destinationChain).toBe('evm');
  });

  it('lists swaps filtered by status', async () => {
    await relayer.initiateSwap({
      sourceChain: 'stellar',
      destinationChain: 'evm',
      sourceLockId: 'lock-2',
      sender: 'addr-1',
      recipient: 'addr-2',
      amount: '500',
      hashlock: '0xdef',
      timelockSource: Date.now() + 3600000,
      timelockDestination: Date.now() + 3600000,
    });

    const all = relayer.listSwaps();
    expect(all).toHaveLength(1);

    const redeemed = relayer.listSwaps('redeemed');
    expect(redeemed).toHaveLength(0);
  });

  it('reveals secret and marks swap as redeemed', async () => {
    const swap = await relayer.initiateSwap({
      sourceChain: 'stellar',
      destinationChain: 'evm',
      sourceLockId: 'lock-3',
      sender: 'addr-1',
      recipient: 'addr-2',
      amount: '200',
      hashlock: '0xghi',
      timelockSource: Date.now() + 3600000,
      timelockDestination: Date.now() + 3600000,
    });

    await relayer.updateSwapStatus(swap.id, {
      status: 'both_locked',
      destinationLockId: 'evm-lock-1',
    });

    const redeemed = await relayer.revealSecret(swap.id, 'my-secret-preimage');
    expect(redeemed?.status).toBe('redeemed');
    expect(redeemed?.secret).toBe('my-secret-preimage');
  });

  it('cannot reveal secret for non-lockable swap', async () => {
    const swap = await relayer.initiateSwap({
      sourceChain: 'evm',
      destinationChain: 'stellar',
      sourceLockId: 'lock-4',
      sender: 'addr-1',
      recipient: 'addr-2',
      amount: '100',
      hashlock: '0xjkl',
      timelockSource: Date.now() + 3600000,
      timelockDestination: Date.now() + 3600000,
    });

    const result = await relayer.revealSecret(swap.id, 'secret');
    expect(result).toBeUndefined();
  });

  it('emits events on swap lifecycle', async () => {
    const events: string[] = [];
    relayer.on('swap:initiated', () => events.push('initiated'));
    relayer.on('swap:redeemed', () => events.push('redeemed'));

    const swap = await relayer.initiateSwap({
      sourceChain: 'stellar',
      destinationChain: 'evm',
      sourceLockId: 'lock-5',
      sender: 'addr-1',
      recipient: 'addr-2',
      amount: '100',
      hashlock: '0xmno',
      timelockSource: Date.now() + 3600000,
      timelockDestination: Date.now() + 3600000,
    });

    await relayer.updateSwapStatus(swap.id, { status: 'both_locked', destinationLockId: 'evm-lock' });
    await relayer.revealSecret(swap.id, 'preimage');

    expect(events).toContain('initiated');
    expect(events).toContain('redeemed');
  });

  it('returns analytics', async () => {
    await relayer.initiateSwap({
      sourceChain: 'stellar',
      destinationChain: 'evm',
      sourceLockId: 'lock-6',
      sender: 'addr-1',
      recipient: 'addr-2',
      amount: '1000',
      hashlock: '0xpqr',
      timelockSource: Date.now() + 3600000,
      timelockDestination: Date.now() + 3600000,
    });

    const analytics = relayer.getAnalytics();
    expect(analytics.total).toBe(1);
    expect(analytics.byStatus['initiated']).toBe(1);
    expect(analytics.byDirection['stellar-evm']).toBe(1);
  });

  it('updates config', () => {
    const config = relayer.updateConfig({ pollIntervalMs: 5000, maxRetries: 5 });
    expect(config.pollIntervalMs).toBe(5000);
    expect(config.maxRetries).toBe(5);
    expect(relayer.getConfig().pollIntervalMs).toBe(5000);
  });

  it('starts and stops polling', () => {
    relayer.start();
    relayer.start();
    relayer.stop();
    relayer.stop();
  });
});
