import { createHash, randomUUID } from 'node:crypto';

export const AUDIT_GENESIS_HASH = '0'.repeat(64);

export interface ImmutableAuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  details: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface ImmutableAuditStore {
  getLatestAuditHash(): Promise<string | undefined>;
  appendAuditEntry(entry: ImmutableAuditLogEntry): Promise<void>;
}

export function canonicalizeDetails(details: Record<string, unknown> = {}): string {
  return JSON.stringify(sortJson(details));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, sortJson(nested)])
  );
}

export function computeAuditHash(input: {
  previousHash: string;
  timestamp: string | number | Date;
  actor: string;
  action: string;
  resource: string;
  details?: Record<string, unknown>;
}): string {
  const timestamp = input.timestamp instanceof Date ? input.timestamp.toISOString() : String(input.timestamp);
  return createHash('sha256')
    .update(input.previousHash)
    .update(timestamp)
    .update(input.actor)
    .update(input.action)
    .update(input.resource)
    .update(canonicalizeDetails(input.details ?? {}))
    .digest('hex');
}

export class ImmutableAuditLogger {
  private inMemoryEntries: ImmutableAuditLogEntry[] = [];
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly store?: ImmutableAuditStore) {}

  async log(input: {
    actor?: string;
    action: string;
    resource: string;
    details?: Record<string, unknown>;
  }): Promise<ImmutableAuditLogEntry> {
    let created!: ImmutableAuditLogEntry;
    this.writeLock = this.writeLock.then(async () => {
      const previousHash = (await this.store?.getLatestAuditHash()) ?? this.inMemoryEntries.at(-1)?.hash ?? AUDIT_GENESIS_HASH;
      const timestamp = new Date().toISOString();
      const details = input.details ?? {};
      created = {
        id: randomUUID(),
        timestamp,
        actor: input.actor ?? 'system',
        action: input.action,
        resource: input.resource,
        details,
        previousHash,
        hash: computeAuditHash({
          previousHash,
          timestamp,
          actor: input.actor ?? 'system',
          action: input.action,
          resource: input.resource,
          details,
        }),
      };

      if (this.store) {
        try {
          await this.store.appendAuditEntry(created);
        } catch (error) {
          console.warn('[audit] Failed to persist immutable audit entry; retaining in memory', error);
        }
      }
      this.inMemoryEntries.push(created);
    });

    await this.writeLock;
    return created;
  }

  getInMemoryEntries(): ImmutableAuditLogEntry[] {
    return [...this.inMemoryEntries];
  }
}
