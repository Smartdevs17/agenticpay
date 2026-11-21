/**
 * WebSocket event stream – bridges the indexer event bus to connected WS clients.
 * Supports filtering by contractAddress, eventType, and time range.
 * Uses Redis pub/sub for cross-instance broadcasting.
 */
import { EventEmitter } from 'node:events';
import type { AgenticPayWebSocketServer } from '../websocket/server.js';
import type { NormalizedEvent } from './soroban-listener.js';

export interface EventStreamOptions {
  wsServer: AgenticPayWebSocketServer;
  /** Optional Redis client for cross-instance pub/sub; if omitted events only broadcast locally */
  redisPublish?: (channel: string, message: string) => Promise<void>;
  redisSubscribe?: (channel: string, handler: (message: string) => void) => Promise<void>;
}

export interface EventFilter {
  contractAddress?: string;
  eventType?: string;
  fromTimestamp?: Date;
  toTimestamp?: Date;
}

const REDIS_CHANNEL = 'indexer:events';

export class EventStreamHandler extends EventEmitter {
  private readonly wsServer: AgenticPayWebSocketServer;
  private readonly redisPublish?: EventStreamOptions['redisPublish'];

  constructor(opts: EventStreamOptions) {
    super();
    this.wsServer = opts.wsServer;
    this.redisPublish = opts.redisPublish;

    // Subscribe to cross-instance events
    if (opts.redisSubscribe) {
      void opts.redisSubscribe(REDIS_CHANNEL, (raw) => {
        try {
          const event = JSON.parse(raw) as NormalizedEvent;
          this.pushToClients(event);
        } catch {
          // ignore malformed messages
        }
      });
    }
  }

  /**
   * Called by SorobanListener / EvmListener when a new event is confirmed.
   */
  async ingest(event: NormalizedEvent): Promise<void> {
    this.emit('indexed', event);

    // Fan-out to local WS clients
    this.pushToClients(event);

    // Fan-out to other instances via Redis pub/sub
    if (this.redisPublish) {
      await this.redisPublish(REDIS_CHANNEL, JSON.stringify(event)).catch(() => {
        // non-fatal: local delivery already done
      });
    }
  }

  private pushToClients(event: NormalizedEvent): void {
    // Broadcast to the contract-specific channel AND the wildcard channel
    const channels = [
      `indexer.${event.chain}.${event.contractAddress.toLowerCase()}`,
      `indexer.${event.chain}.all`,
      'indexer.all',
    ];

    for (const channel of channels) {
      this.wsServer.broadcastToChannel(channel, {
        type: 'indexer.event',
        payload: {
          id: event.id,
          chain: event.chain,
          contractAddress: event.contractAddress,
          eventType: event.eventType,
          blockNumber: event.blockNumber,
          txHash: event.txHash,
          timestamp: event.timestamp.toISOString(),
          payload: event.payload,
          confirmations: event.confirmations,
        },
      });
    }
  }

  /** Filter helper used by the REST history endpoint */
  static matchesFilter(event: NormalizedEvent, filter: EventFilter): boolean {
    if (filter.contractAddress && event.contractAddress.toLowerCase() !== filter.contractAddress.toLowerCase()) {
      return false;
    }
    if (filter.eventType && event.eventType !== filter.eventType) return false;
    if (filter.fromTimestamp && event.timestamp < filter.fromTimestamp) return false;
    if (filter.toTimestamp && event.timestamp > filter.toTimestamp) return false;
    return true;
  }
}
