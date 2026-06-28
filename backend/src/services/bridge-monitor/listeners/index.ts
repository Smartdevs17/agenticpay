/**
 * Per-bridge event listeners — Issue #475
 *
 * Normalizes bridge events from Wormhole, LayerZero, Axelar, and custom bridges.
 */

import type { BridgeMessageStatus, BridgeProvider } from '@prisma/client';

export interface BridgeEvent {
  provider: BridgeProvider;
  messageId: string;
  sourceChain: string;
  destinationChain: string;
  status: BridgeMessageStatus;
  txHashSource?: string;
  txHashDestination?: string;
  amount?: string;
  tokenAddress?: string;
  sender?: string;
  recipient?: string;
  gasCostSource?: string;
  gasCostDestination?: string;
  metadata?: Record<string, unknown>;
}

export interface BridgeListener {
  provider: BridgeProvider;
  poll(): Promise<BridgeEvent[]>;
}

class WormholeListener implements BridgeListener {
  provider: BridgeProvider = 'wormhole';

  async poll(): Promise<BridgeEvent[]> {
    const apiUrl = process.env.WORMHOLE_API_URL;
    if (!apiUrl) return [];

    try {
      const res = await fetch(`${apiUrl}/v1/signed_vaa`);
      if (!res.ok) return [];
      const data = (await res.json()) as { messages?: Array<Record<string, unknown>> };
      return (data.messages ?? []).slice(0, 50).map((m, i) => this.normalize(m, i));
    } catch {
      return [];
    }
  }

  private normalize(raw: Record<string, unknown>, index: number): BridgeEvent {
    return {
      provider: 'wormhole',
      messageId: String(raw.sequence ?? raw.id ?? `wh-${index}-${Date.now()}`),
      sourceChain: String(raw.emitterChain ?? 'unknown'),
      destinationChain: String(raw.targetChain ?? 'unknown'),
      status: raw.confirmed ? 'destination_executed' : 'relayed',
      txHashSource: raw.txHash ? String(raw.txHash) : undefined,
      metadata: raw,
    };
  }
}

class LayerZeroListener implements BridgeListener {
  provider: BridgeProvider = 'layerzero';

  async poll(): Promise<BridgeEvent[]> {
    const rpcUrl = process.env.LAYERZERO_RPC_URL ?? process.env.EVM_RPC_URL;
    if (!rpcUrl) return [];
    return [];
  }
}

class AxelarListener implements BridgeListener {
  provider: BridgeProvider = 'axelar';

  async poll(): Promise<BridgeEvent[]> {
    const apiUrl = process.env.AXELAR_API_URL;
    if (!apiUrl) return [];

    try {
      const res = await fetch(`${apiUrl}/cross-chain/transfers?status=pending`);
      if (!res.ok) return [];
      const data = (await res.json()) as { transfers?: Array<Record<string, unknown>> };
      return (data.transfers ?? []).slice(0, 50).map((t, i) => ({
        provider: 'axelar' as BridgeProvider,
        messageId: String(t.id ?? `ax-${i}`),
        sourceChain: String(t.sourceChain ?? 'unknown'),
        destinationChain: String(t.destinationChain ?? 'unknown'),
        status: (t.status === 'completed' ? 'destination_executed' : 'relayed') as BridgeMessageStatus,
        amount: t.amount ? String(t.amount) : undefined,
        sender: t.sender ? String(t.sender) : undefined,
        recipient: t.recipient ? String(t.recipient) : undefined,
        metadata: t,
      }));
    } catch {
      return [];
    }
  }
}

class CustomBridgeListener implements BridgeListener {
  provider: BridgeProvider = 'custom';

  async poll(): Promise<BridgeEvent[]> {
    return [];
  }
}

const listeners: BridgeListener[] = [
  new WormholeListener(),
  new LayerZeroListener(),
  new AxelarListener(),
  new CustomBridgeListener(),
];

export function getBridgeListeners(): BridgeListener[] {
  return listeners;
}

export async function pollAllBridgeEvents(): Promise<BridgeEvent[]> {
  const results = await Promise.allSettled(listeners.map((l) => l.poll()));
  const events: BridgeEvent[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') events.push(...result.value);
  }
  return events;
}
