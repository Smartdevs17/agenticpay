/**
 * EVM event listener – uses ethers.js to subscribe to / poll contract logs,
 * normalises them into IndexedEvent shape, and emits to the indexer event bus.
 * Handles chain reorganisations by requiring MIN_CONFIRMATIONS before emitting.
 */
import { EventEmitter } from 'node:events';
import { ethers } from 'ethers';
import type { NormalizedEvent } from './soroban-listener.js';

export interface EvmListenerOptions {
  rpcUrl: string;
  contractAddress: string;
  abi: ethers.InterfaceAbi;
  minConfirmations?: number;
  pollIntervalMs?: number;
}

// Minimal ABI covering the events we care about.
const DEFAULT_ABI: ethers.InterfaceAbi = [
  'event PaymentSent(address indexed from, address indexed to, uint256 amount)',
  'event PaymentReceived(address indexed from, address indexed to, uint256 amount)',
  'event DisputeRaised(bytes32 indexed projectId, address indexed initiator)',
  'event SettlementCompleted(bytes32 indexed projectId, uint256 amount)',
  'event EscrowFunded(bytes32 indexed projectId, uint256 amount)',
  'event EscrowReleased(bytes32 indexed projectId, uint256 amount)',
];

export class EvmListener extends EventEmitter {
  private readonly contractAddress: string;
  private readonly minConfirmations: number;
  private readonly pollIntervalMs: number;
  private provider: ethers.JsonRpcProvider | null = null;
  private contract: ethers.Contract | null = null;
  private abi: ethers.InterfaceAbi;
  private rpcUrl: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastBlock = 0;

  constructor(opts: EvmListenerOptions) {
    super();
    this.contractAddress = opts.contractAddress;
    this.abi = opts.abi ?? DEFAULT_ABI;
    this.rpcUrl = opts.rpcUrl;
    this.minConfirmations = opts.minConfirmations ?? 6;
    this.pollIntervalMs = opts.pollIntervalMs ?? 12_000;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
    this.contract = new ethers.Contract(this.contractAddress, this.abi, this.provider);

    try {
      this.lastBlock = (await this.provider.getBlockNumber()) - this.minConfirmations;
    } catch {
      this.lastBlock = 0;
    }

    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.provider = null;
    this.contract = null;
  }

  private async poll(): Promise<void> {
    if (!this.provider || !this.contract) return;

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const safeBlock = currentBlock - this.minConfirmations;
      if (safeBlock <= this.lastBlock) return;

      const logs = await this.contract.queryFilter('*', this.lastBlock + 1, safeBlock);

      for (const log of logs) {
        const event = this.normalizeLog(log, safeBlock);
        if (event) this.emit('event', event);
      }

      this.lastBlock = safeBlock;
    } catch (err) {
      this.emit('error', err);
    }
  }

  private normalizeLog(
    log: ethers.EventLog | ethers.Log,
    currentSafeBlock: number,
  ): NormalizedEvent | null {
    try {
      const blockNum = log.blockNumber ?? 0;
      const isEventLog = 'eventName' in log;
      return {
        id: `evm:${log.transactionHash}:${log.index ?? 0}`,
        chain: 'evm',
        contractAddress: this.contractAddress,
        eventType: isEventLog ? (log as ethers.EventLog).eventName : 'UnknownEvent',
        blockNumber: blockNum,
        txHash: log.transactionHash ?? '',
        timestamp: new Date(), // block timestamp requires extra RPC call; set at persist time
        payload: isEventLog
          ? this.serializeArgs((log as ethers.EventLog).args)
          : { data: log.data, topics: log.topics },
        confirmations: currentSafeBlock - blockNum,
      };
    } catch {
      return null;
    }
  }

  private serializeArgs(args: ethers.Result): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      out[k] = typeof v === 'bigint' ? v.toString() : v;
    }
    return out;
  }
}

export { DEFAULT_ABI as EVM_DEFAULT_ABI };
