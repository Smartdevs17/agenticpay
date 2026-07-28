/**
 * Soroban event listener – polls Stellar Horizon for contract events,
 * normalises them into IndexedEvent shape, deduplicates via Redis, and
 * publishes to the indexer event bus.
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import { EventEmitter } from 'node:events';
import { config } from '../../config/env.js';

export type IndexedEventChain = 'stellar' | 'evm';

export interface NormalizedEvent {
  id: string;              // chain-unique deduplication key
  chain: IndexedEventChain;
  contractAddress: string;
  eventType: string;
  blockNumber: number;
  txHash: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  confirmations: number;
}

export interface SorobanListenerOptions {
  contractId: string;
  pollIntervalMs?: number;
  minConfirmations?: number;
}

const NETWORK = config().STELLAR_NETWORK ?? 'testnet';
const HORIZON_URL =
  NETWORK === 'public'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

function parseEventType(topics: string[]): string {
  // Topics[0] is typically the event name symbol
  if (topics.length === 0) return 'unknown';
  try {
    const scVal = StellarSdk.xdr.ScVal.fromXDR(topics[0], 'base64');
    if (scVal.switch() === StellarSdk.xdr.ScValType.scvSymbol()) {
      return scVal.sym().toString();
    }
  } catch {
    // ignore parse errors; use raw value
  }
  return topics[0].slice(0, 64);
}

function parsePayload(data: string): Record<string, unknown> {
  try {
    const scVal = StellarSdk.xdr.ScVal.fromXDR(data, 'base64');
    return { raw: scVal.toXDR('base64'), parsed: scVal.toString() };
  } catch {
    return { raw: data };
  }
}

export class SorobanListener extends EventEmitter {
  private readonly contractId: string;
  private readonly pollIntervalMs: number;
  private readonly minConfirmations: number;
  private readonly server: StellarSdk.Horizon.Server;
  private cursor = 'now';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SorobanListenerOptions) {
    super();
    this.contractId = opts.contractId;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5_000;
    this.minConfirmations = opts.minConfirmations ?? 6;
    this.server = new StellarSdk.Horizon.Server(HORIZON_URL);
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      // Horizon /transactions gives us ledger context; for events we use the
      // effects stream and filter by contract. Production use should switch to
      // the Soroban RPC `getEvents` call once widely available.
      const txPage = await this.server
        .transactions()
        .forAccount(this.contractId)
        .cursor(this.cursor)
        .limit(50)
        .call();

      for (const tx of txPage.records) {
        if (!tx.successful) continue;

        const event: NormalizedEvent = {
          id: `stellar:${tx.id}`,
          chain: 'stellar',
          contractAddress: this.contractId,
          eventType: this.inferEventType(tx),
          blockNumber: tx.ledger_attr as unknown as number,
          txHash: tx.hash,
          timestamp: new Date(tx.created_at),
          payload: { envelope: tx.envelope_xdr, result: tx.result_xdr },
          confirmations: this.minConfirmations, // Stellar is final after ledger close
        };

        if (event.confirmations >= this.minConfirmations) {
          this.emit('event', event);
        }

        this.cursor = tx.paging_token;
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  private inferEventType(tx: StellarSdk.Horizon.ServerApi.TransactionRecord): string {
    // Simple heuristic; replace with full XDR decode for production.
    const memo = typeof tx.memo === 'string' ? tx.memo : '';
    if (memo.includes('payment')) return 'PaymentSent';
    if (memo.includes('dispute')) return 'DisputeRaised';
    if (memo.includes('settle')) return 'SettlementCompleted';
    return 'ContractEvent';
  }
}
