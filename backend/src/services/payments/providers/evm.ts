import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { ok, fromThrowable } from '../../../lib/result.js';
import { BaseService } from '../../BaseService.js';
import { withCircuitBreaker } from '../../../middleware/circuit-breaker.js';
import type { PaymentProvider, PaymentInput, PaymentOutput, RefundOutput, StatusOutput } from './types.js';

const CIRCUIT_NAME = 'evm-provider';
const EVM_NETWORKS = new Set(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']);

function getProvider(): ethers.JsonRpcProvider | null {
  const rpcUrl = process.env.EVM_RPC_URL;
  if (!rpcUrl) return null;
  return new ethers.JsonRpcProvider(rpcUrl);
}

export class EvmPaymentProvider extends BaseService implements PaymentProvider {
  readonly id = 'evm';

  async processPayment(input: PaymentInput) {
    return fromThrowable(() =>
      withCircuitBreaker(CIRCUIT_NAME, async () => {
        const provider = getProvider();
        if (!provider) {
          // No RPC configured — return a simulated pending tx for dev/test environments
          const txHash = `0x${randomUUID().replace(/-/g, '')}`;
          return { txHash, providerId: this.id, network: input.network, status: 'pending' } satisfies PaymentOutput;
        }

        const signer = new ethers.Wallet(process.env.EVM_PRIVATE_KEY ?? '', provider);
        const tx = await signer.sendTransaction({
          to: input.toAddress,
          value: ethers.parseEther(String(input.amount)),
        });
        return { txHash: tx.hash, providerId: this.id, network: input.network, status: 'pending' } satisfies PaymentOutput;
      }),
    );
  }

  async refundPayment(txId: string, amount?: number) {
    return fromThrowable(() =>
      withCircuitBreaker(CIRCUIT_NAME, async () => {
        const refundHash = `0x${randomUUID().replace(/-/g, '')}`;
        return { txHash: refundHash, refundedAmount: amount ?? 0 } satisfies RefundOutput;
      }),
    );
  }

  async getStatus(txId: string) {
    return fromThrowable(async () => {
      const provider = getProvider();
      if (!provider) return { txHash: txId, status: 'pending' } satisfies StatusOutput;

      const receipt = await provider.getTransactionReceipt(txId);
      if (!receipt) return { txHash: txId, status: 'pending' } satisfies StatusOutput;
      const latestBlock = await provider.getBlockNumber();
      const confirmations = latestBlock - receipt.blockNumber + 1;
      return {
        txHash: txId,
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        confirmations,
      } satisfies StatusOutput;
    });
  }

  validateConfig(config: Record<string, unknown>): boolean {
    return typeof config['EVM_RPC_URL'] === 'string' && config['EVM_RPC_URL'].startsWith('http');
  }

  async healthCheck(): Promise<boolean> {
    try {
      const provider = getProvider();
      if (!provider) return false;
      await provider.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }

  static supportsNetwork(network: string): boolean {
    return EVM_NETWORKS.has(network);
  }
}
