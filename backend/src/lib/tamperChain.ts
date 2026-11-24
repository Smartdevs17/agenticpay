import { createHash } from 'node:crypto';

export const TAMPER_CHAIN_GENESIS_HASH = '0'.repeat(64);

export interface TamperChainInput {
  timestamp: number;
  actor: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
}

export interface TamperChainEntry extends TamperChainInput {
  sequence: number;
  previousHash: string;
  hash: string;
}

export interface TamperChainVerificationResult {
  valid: boolean;
  checked: number;
  brokenAt?: number;
  reason?: 'sequence' | 'link' | 'hash';
  expectedHash?: string;
  actualHash?: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        if (record[key] !== undefined) acc[key] = canonicalize(record[key]);
        return acc;
      }, {});
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value) ?? null);
}

export function computeTamperHash(entry: Omit<TamperChainEntry, 'hash'>): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        sequence: entry.sequence,
        timestamp: entry.timestamp,
        actor: entry.actor,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        details: entry.details ?? {},
        previousHash: entry.previousHash,
      }),
    )
    .digest('hex');
}

export function createTamperChainEntry(
  input: TamperChainInput,
  sequence: number,
  previousHash: string,
): TamperChainEntry {
  const entry: Omit<TamperChainEntry, 'hash'> = {
    sequence,
    timestamp: Math.trunc(input.timestamp),
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId,
    details: input.details,
    previousHash,
  };
  return { ...entry, hash: computeTamperHash(entry) };
}

export function verifyTamperChain(entries: readonly TamperChainEntry[]): TamperChainVerificationResult {
  let previousHash = TAMPER_CHAIN_GENESIS_HASH;

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const position = index + 1;
    if (entry.sequence !== position) {
      return { valid: false, checked: index, brokenAt: position, reason: 'sequence', actualHash: entry.hash };
    }
    if (entry.previousHash !== previousHash) {
      return { valid: false, checked: index, brokenAt: position, reason: 'link', expectedHash: previousHash, actualHash: entry.previousHash };
    }
    const expectedHash = computeTamperHash(entry);
    if (expectedHash !== entry.hash) {
      return { valid: false, checked: index, brokenAt: position, reason: 'hash', expectedHash, actualHash: entry.hash };
    }
    previousHash = entry.hash;
  }

  return { valid: true, checked: entries.length };
}
