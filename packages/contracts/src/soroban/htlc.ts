/**
 * TypeScript bindings for the Soroban HTLC (Hash Time-Locked Contract).
 *
 * Wraps Soroban contract invocation for atomic swap lifecycle management.
 *
 * Issue #470 — Implement Stellar Soroban Atomic Swap with Hash TimeLock Contracts
 */

export enum HtlcErrorCode {
  AlreadyInitialized = 1,
  NotInitialized = 2,
  Unauthorized = 3,
  SwapNotFound = 4,
  InvalidAmount = 5,
  HashlockMismatch = 6,
  TimelockExpired = 7,
  TimelockNotExpired = 8,
  SwapNotPending = 9,
  AlreadyClaimed = 10,
  AlreadyRefunded = 11,
  InvalidTimelock = 12,
  InvalidDisputeWindow = 13,
  FeeTooHigh = 14,
  DisputeWindowNotElapsed = 15,
}

export const HTLC_ERROR_MESSAGES: Record<number, string> = {
  1: 'AlreadyInitialized',
  2: 'NotInitialized',
  3: 'Unauthorized',
  4: 'SwapNotFound',
  5: 'InvalidAmount',
  6: 'HashlockMismatch',
  7: 'TimelockExpired',
  8: 'TimelockNotExpired',
  9: 'SwapNotPending',
  10: 'AlreadyClaimed',
  11: 'AlreadyRefunded',
  12: 'InvalidTimelock',
  13: 'InvalidDisputeWindow',
  14: 'FeeTooHigh',
  15: 'DisputeWindowNotElapsed',
};

export class HtlcError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
    this.name = 'HtlcError';
  }
}

export interface HtlcConfig {
  contractAddress: string;
  rpcUrl: string;
  network: 'testnet' | 'mainnet';
}

export interface CreateSwapParams {
  sender: string;
  receiver: string;
  tokenA: string;
  tokenB: string;
  amountA: bigint;
  amountB: bigint;
  hashlock: string;
  timelockSeconds: number;
  disputeWindowSeconds: number;
  feeBps: number;
  feeCollector: string;
}

export interface SwapData {
  sender: string;
  receiver: string;
  tokenA: string;
  tokenB: string;
  amountA: bigint;
  amountB: bigint;
  hashlock: string;
  timelock: number;
  disputeDeadline: number;
  status: number;
  feeBps: number;
  feeCollector: string;
}

export class SorobanHtlcClient {
  private readonly contractAddress: string;
  private readonly rpcUrl: string;
  private readonly network: 'testnet' | 'mainnet';

  constructor(config: HtlcConfig) {
    this.contractAddress = config.contractAddress;
    this.rpcUrl = config.rpcUrl;
    this.network = config.network;
  }

  buildInitializeTx(params: { admin: string }): Record<string, unknown> {
    return this.buildInvocation('initialize', [
      { type: 'address', value: params.admin },
    ]);
  }

  buildCreateSwapTx(params: CreateSwapParams): Record<string, unknown> {
    return this.buildInvocation('create_swap', [
      { type: 'address', value: params.sender },
      { type: 'address', value: params.receiver },
      { type: 'address', value: params.tokenA },
      { type: 'address', value: params.tokenB },
      { type: 'i128', value: params.amountA.toString() },
      { type: 'i128', value: params.amountB.toString() },
      { type: 'bytes32', value: params.hashlock },
      { type: 'u64', value: params.timelockSeconds },
      { type: 'u64', value: params.disputeWindowSeconds },
      { type: 'u32', value: params.feeBps },
      { type: 'address', value: params.feeCollector },
    ]);
  }

  buildClaimTx(params: { swapId: bigint; preimage: string }): Record<string, unknown> {
    return this.buildInvocation('claim', [
      { type: 'u64', value: params.swapId.toString() },
      { type: 'bytes32', value: params.preimage },
    ]);
  }

  buildRefundTx(params: { swapId: bigint }): Record<string, unknown> {
    return this.buildInvocation('refund', [
      { type: 'u64', value: params.swapId.toString() },
    ]);
  }

  buildRaiseDisputeTx(params: { swapId: bigint }): Record<string, unknown> {
    return this.buildInvocation('raise_dispute', [
      { type: 'u64', value: params.swapId.toString() },
    ]);
  }

  buildResolveDisputeTx(params: { admin: string; swapId: bigint; releaseToReceiver: boolean }): Record<string, unknown> {
    return this.buildInvocation('resolve_dispute', [
      { type: 'address', value: params.admin },
      { type: 'u64', value: params.swapId.toString() },
      { type: 'bool', value: params.releaseToReceiver },
    ]);
  }

  async getSwap(swapId: bigint): Promise<SwapData> {
    const raw = await this.simulateInvocation('get_swap', [
      { type: 'u64', value: swapId.toString() },
    ]);
    return this.decodeSwap(raw);
  }

  async getSwapCount(): Promise<bigint> {
    const raw = await this.simulateInvocation('get_swap_count', []);
    return BigInt(String(raw));
  }

  async getSecret(swapId: bigint): Promise<string> {
    const raw = await this.simulateInvocation('get_secret', [
      { type: 'u64', value: swapId.toString() },
    ]);
    return String(raw);
  }

  async admin(): Promise<string> {
    const raw = await this.simulateInvocation('admin', []);
    return String(raw);
  }

  async version(): Promise<number> {
    const raw = await this.simulateInvocation('version', []);
    return Number(raw);
  }

  private decodeSwap(raw: unknown): SwapData {
    const v = raw as Record<string, unknown>;
    return {
      sender: String(v['sender'] ?? ''),
      receiver: String(v['receiver'] ?? ''),
      tokenA: String(v['token_a'] ?? ''),
      tokenB: String(v['token_b'] ?? ''),
      amountA: BigInt(String(v['amount_a'] ?? 0)),
      amountB: BigInt(String(v['amount_b'] ?? 0)),
      hashlock: String(v['hashlock'] ?? ''),
      timelock: Number(v['timelock'] ?? 0),
      disputeDeadline: Number(v['dispute_deadline'] ?? 0),
      status: Number(v['status'] ?? 0),
      feeBps: Number(v['fee_bps'] ?? 0),
      feeCollector: String(v['fee_collector'] ?? ''),
    };
  }

  private buildInvocation(method: string, args: Array<{ type: string; value: unknown }>): Record<string, unknown> {
    return { contractAddress: this.contractAddress, method, args, network: this.network, rpcUrl: this.rpcUrl };
  }

  private async simulateInvocation(method: string, args: Array<{ type: string; value: unknown }>): Promise<unknown> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: { transaction: this.buildInvocation(method, args) },
      }),
    });

    if (!response.ok) throw new HtlcError(`RPC failed: ${response.statusText}`, 0);

    const json = (await response.json()) as { result?: { results?: Array<{ xdr: string }> }; error?: { code: number; message: string } };
    if (json.error) {
      const msg = HTLC_ERROR_MESSAGES[json.error.code] ?? json.error.message;
      throw new HtlcError(msg, json.error.code);
    }

    return json.result?.results?.[0] ?? null;
  }
}
