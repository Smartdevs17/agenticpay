/**
 * Money-movement audit log — Issue #1011
 *
 * Every operation that moves (or reserves, or returns) money is appended here as an
 * immutable, hash-chained entry recording who did it, how much moved and against which
 * reference. Entries reuse the `ImmutableAuditLogEntry` shape and `computeAuditHash`, so
 * the existing `verifyAuditChain` tooling (and its tamper alerting) applies unchanged.
 *
 * - Append-only: there is no update or delete API, and returned entries are frozen copies.
 * - Tamper-evident: each entry's hash covers the previous hash plus the full movement
 *   record (actor, amount, asset, reference, ...). Editing, reordering or dropping an
 *   entry breaks the chain and `verify()` reports where.
 * - Queryable: `query()` filters by actor, merchant, operation, reference, asset, amount
 *   range and time window for compliance review.
 */

import { randomUUID } from 'node:crypto';
import {
  AUDIT_GENESIS_HASH,
  computeAuditHash,
  type ImmutableAuditLogEntry,
  type ImmutableAuditStore,
} from './immutable-logger.js';
import { verifyAuditChain, type AuditIntegrityResult } from './chain-verifier.js';

/** Resource name every money-movement entry is filed under. */
export const MONEY_MOVEMENT_RESOURCE = 'money_movement';

export type MoneyMovementOperation =
  | 'balance.set'
  | 'payout.reserved'
  | 'payout.approved'
  | 'payout.rejected'
  | 'payout.settled'
  | 'payout.failed'
  | 'payout.released'
  | 'payout.scheduled'
  | 'payout.cancelled'
  | 'payout.held'
  | 'payout_batch.settled'
  | 'payout_batch.failed';

export interface MoneyMovementInput {
  /** Who initiated the movement: a user/approver id, or `system` for automated passes. */
  actor: string;
  operation: MoneyMovementOperation;
  amount: number;
  asset: string;
  /** Business reference the movement belongs to (batch id, scheduled payout id, ...). */
  reference: string;
  merchantId?: string;
  /** Extra context. Never put secrets here: entries are retained for compliance. */
  metadata?: Record<string, unknown>;
}

/** Typed view of an entry, flattened from the hashed `details` payload. */
export interface MoneyMovementRecord {
  id: string;
  sequence: number;
  timestamp: string;
  actor: string;
  operation: MoneyMovementOperation;
  amount: number;
  asset: string;
  reference: string;
  merchantId?: string;
  metadata?: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface MoneyMovementQuery {
  actor?: string;
  merchantId?: string;
  operation?: MoneyMovementOperation | MoneyMovementOperation[];
  reference?: string;
  asset?: string;
  minAmount?: number;
  maxAmount?: number;
  from?: Date;
  to?: Date;
  /** Max records returned (newest last). Defaults to 500, capped at 5,000. */
  limit?: number;
  offset?: number;
}

export interface MoneyMovementQueryResult {
  records: MoneyMovementRecord[];
  total: number;
  totalAmountByAsset: Record<string, number>;
}

export interface MoneyMovementAuditLogOptions {
  /** Optional durable sink; writes are best-effort and never block the money path. */
  store?: ImmutableAuditStore;
  now?: () => Date;
}

const DEFAULT_QUERY_LIMIT = 500;
const MAX_QUERY_LIMIT = 5_000;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function cloneEntry(entry: ImmutableAuditLogEntry): ImmutableAuditLogEntry {
  return deepFreeze(structuredClone(entry));
}

export class MoneyMovementAuditLog {
  private readonly entries: ImmutableAuditLogEntry[] = [];
  private readonly store?: ImmutableAuditStore;
  private readonly now: () => Date;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(options: MoneyMovementAuditLogOptions = {}) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  /** Appends a movement and returns its frozen record. */
  record(input: MoneyMovementInput): MoneyMovementRecord {
    if (!input.actor) throw new Error('AUDIT_ACTOR_REQUIRED');
    if (!input.reference) throw new Error('AUDIT_REFERENCE_REQUIRED');
    if (!Number.isFinite(input.amount)) throw new Error('AUDIT_AMOUNT_INVALID');

    const previousHash = this.entries.at(-1)?.hash ?? AUDIT_GENESIS_HASH;
    const timestamp = this.now().toISOString();
    const details: Record<string, unknown> = {
      sequence: this.entries.length + 1,
      operation: input.operation,
      amount: input.amount,
      asset: input.asset,
      reference: input.reference,
      ...(input.merchantId !== undefined ? { merchantId: input.merchantId } : {}),
      ...(input.metadata !== undefined ? { metadata: structuredClone(input.metadata) } : {}),
    };

    const entry: ImmutableAuditLogEntry = deepFreeze({
      id: randomUUID(),
      timestamp,
      actor: input.actor,
      action: input.operation,
      resource: MONEY_MOVEMENT_RESOURCE,
      details,
      previousHash,
      hash: computeAuditHash({
        previousHash,
        timestamp,
        actor: input.actor,
        action: input.operation,
        resource: MONEY_MOVEMENT_RESOURCE,
        details,
      }),
    });

    this.entries.push(entry);
    this.persist(entry);
    return toRecord(entry);
  }

  /** Filtered, paginated view for compliance review. */
  query(filter: MoneyMovementQuery = {}): MoneyMovementQueryResult {
    const operations = filter.operation
      ? new Set(Array.isArray(filter.operation) ? filter.operation : [filter.operation])
      : undefined;

    const matched = this.entries.map(toRecord).filter((record) => {
      if (filter.actor && record.actor !== filter.actor) return false;
      if (filter.merchantId && record.merchantId !== filter.merchantId) return false;
      if (operations && !operations.has(record.operation)) return false;
      if (filter.reference && record.reference !== filter.reference) return false;
      if (filter.asset && record.asset !== filter.asset) return false;
      if (filter.minAmount !== undefined && record.amount < filter.minAmount) return false;
      if (filter.maxAmount !== undefined && record.amount > filter.maxAmount) return false;
      const at = Date.parse(record.timestamp);
      if (filter.from && at < filter.from.getTime()) return false;
      if (filter.to && at > filter.to.getTime()) return false;
      return true;
    });

    const totalAmountByAsset: Record<string, number> = {};
    for (const record of matched) {
      totalAmountByAsset[record.asset] = (totalAmountByAsset[record.asset] ?? 0) + record.amount;
    }

    const limit = Math.min(Math.max(1, filter.limit ?? DEFAULT_QUERY_LIMIT), MAX_QUERY_LIMIT);
    const offset = Math.max(0, filter.offset ?? 0);
    return {
      records: matched.slice(offset, offset + limit),
      total: matched.length,
      totalAmountByAsset,
    };
  }

  /** Raw chain entries (frozen copies), oldest first, for export or external verification. */
  getEntries(): ImmutableAuditLogEntry[] {
    return this.entries.map(cloneEntry);
  }

  /** Re-derives every hash from genesis. `valid: false` pinpoints the first broken entry. */
  verify(): Promise<AuditIntegrityResult> {
    return verifyAuditChain(this.entries);
  }

  /** Resolves once every pending write to the durable store has settled. */
  flush(): Promise<void> {
    return this.persistQueue;
  }

  get size(): number {
    return this.entries.length;
  }

  private persist(entry: ImmutableAuditLogEntry): void {
    if (!this.store) return;
    const store = this.store;
    // Serialised so the store receives entries in chain order.
    this.persistQueue = this.persistQueue.then(() =>
      store.appendAuditEntry(entry).catch((error) => {
        console.warn('[audit] Failed to persist money-movement entry; retained in memory', error);
      }),
    );
  }
}

function toRecord(entry: ImmutableAuditLogEntry): MoneyMovementRecord {
  const d = entry.details as Record<string, unknown>;
  return {
    id: entry.id,
    sequence: d.sequence as number,
    timestamp: entry.timestamp,
    actor: entry.actor,
    operation: d.operation as MoneyMovementOperation,
    amount: d.amount as number,
    asset: d.asset as string,
    reference: d.reference as string,
    ...(d.merchantId !== undefined ? { merchantId: d.merchantId as string } : {}),
    ...(d.metadata !== undefined ? { metadata: structuredClone(d.metadata) as Record<string, unknown> } : {}),
    previousHash: entry.previousHash,
    hash: entry.hash,
  };
}

/** Process-wide log shared by the payout engine, scheduler and compliance routes. */
export const moneyMovementAuditLog = new MoneyMovementAuditLog();
