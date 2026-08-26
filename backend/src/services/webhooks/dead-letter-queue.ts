/**
 * Webhook Dead-Letter Queue (DLQ) Management
 *
 * Handles permanent failure categorization, manual replay (single & batch),
 * DLQ inspection, and purge operations.
 */

import { randomUUID } from 'node:crypto';
import {
  deliveryLogs,
  attemptDelivery,
  listDeliveryLogs,
  type DeliveryLog,
  type FailureCategory,
} from './delivery-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeadLetterEntry {
  id: string;
  deliveryLogId: string;
  endpointId: string;
  merchantId: string;
  eventId: string;
  eventType: string;
  payloadPreview: string;
  failureCategory: FailureCategory;
  lastError?: string;
  originalAttempts: number;
  enqueuedAt: string;
  replayCount: number;
  lastReplayAt?: string;
  purgedAt?: string;
}

export interface ReplayResult {
  deadLetterEntryId: string;
  deliveryLogId: string;
  success: boolean;
  status: string;
  replayedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory DLQ store
// ---------------------------------------------------------------------------

const dlqEntries = new Map<string, DeadLetterEntry>();

// ---------------------------------------------------------------------------
// Auto-enqueue from delivery manager
// ---------------------------------------------------------------------------

export function enqueueDeadLetter(log: DeliveryLog): DeadLetterEntry {
  // Avoid duplicate entries for the same delivery log
  for (const entry of dlqEntries.values()) {
    if (entry.deliveryLogId === log.id && !entry.purgedAt) return entry;
  }

  const entry: DeadLetterEntry = {
    id: randomUUID(),
    deliveryLogId: log.id,
    endpointId: log.endpointId,
    merchantId: log.merchantId,
    eventId: log.eventId,
    eventType: log.eventType,
    payloadPreview: log.payloadPreview,
    failureCategory: log.failureCategory ?? 'unknown',
    lastError: log.lastError,
    originalAttempts: log.attempt,
    enqueuedAt: new Date().toISOString(),
    replayCount: 0,
  };

  dlqEntries.set(entry.id, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export function listDLQ(filters: {
  merchantId?: string;
  endpointId?: string;
  failureCategory?: FailureCategory;
} = {}): DeadLetterEntry[] {
  return Array.from(dlqEntries.values()).filter((e) => {
    if (e.purgedAt) return false;
    if (filters.merchantId && e.merchantId !== filters.merchantId) return false;
    if (filters.endpointId && e.endpointId !== filters.endpointId) return false;
    if (filters.failureCategory && e.failureCategory !== filters.failureCategory) return false;
    return true;
  });
}

export function getDLQEntry(id: string): DeadLetterEntry | undefined {
  return dlqEntries.get(id);
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

async function replayOne(entry: DeadLetterEntry): Promise<ReplayResult> {
  const now = new Date().toISOString();
  entry.replayCount += 1;
  entry.lastReplayAt = now;

  // Reset the delivery log so it can be attempted again
  const dlMap = deliveryLogs as Map<string, DeliveryLog>;
  const original = dlMap.get(entry.deliveryLogId);
  if (original) {
    original.status = 'pending';
    original.attempt = 0;
    original.lastError = undefined;
    original.failureCategory = undefined;
    original.nextAttemptAt = now;
    original.updatedAt = now;
    dlMap.set(original.id, original);
  }

  const result = await attemptDelivery(entry.deliveryLogId);

  return {
    deadLetterEntryId: entry.id,
    deliveryLogId: entry.deliveryLogId,
    success: result.status === 'delivered',
    status: result.status,
    replayedAt: now,
  };
}

export async function replaySingle(entryId: string): Promise<ReplayResult> {
  const entry = dlqEntries.get(entryId);
  if (!entry) throw new Error(`DLQ entry ${entryId} not found`);
  if (entry.purgedAt) throw new Error(`DLQ entry ${entryId} has been purged`);
  return replayOne(entry);
}

export async function replayBatch(
  entryIds: string[]
): Promise<ReplayResult[]> {
  const results: ReplayResult[] = [];
  for (const id of entryIds) {
    const entry = dlqEntries.get(id);
    if (!entry || entry.purgedAt) continue;
    results.push(await replayOne(entry));
  }
  return results;
}

export async function replayAll(merchantId?: string): Promise<ReplayResult[]> {
  const entries = listDLQ(merchantId ? { merchantId } : {});
  const results: ReplayResult[] = [];
  for (const entry of entries) {
    results.push(await replayOne(entry));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

export function purgeDLQEntry(entryId: string): void {
  const entry = dlqEntries.get(entryId);
  if (!entry) throw new Error(`DLQ entry ${entryId} not found`);
  entry.purgedAt = new Date().toISOString();
}

export function purgeByCategory(
  category: FailureCategory,
  merchantId?: string
): number {
  const entries = listDLQ({ failureCategory: category, ...(merchantId ? { merchantId } : {}) });
  for (const e of entries) {
    e.purgedAt = new Date().toISOString();
  }
  return entries.length;
}

// ---------------------------------------------------------------------------
// Sync DLQ from delivery logs (populate from existing dead_letter logs)
// ---------------------------------------------------------------------------

export function syncDLQFromDeliveryLogs(): void {
  const deadLogs = listDeliveryLogs({ status: 'dead_letter' });
  for (const log of deadLogs) {
    enqueueDeadLetter(log);
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface DLQStats {
  total: number;
  byCategory: Record<FailureCategory, number>;
  totalReplayed: number;
  pendingReplay: number;
}

export function getDLQStats(merchantId?: string): DLQStats {
  const entries = listDLQ(merchantId ? { merchantId } : {});

  const byCategory: Record<FailureCategory, number> = {
    invalid_endpoint: 0,
    bad_signature: 0,
    rate_limited: 0,
    timeout: 0,
    http_error: 0,
    ssl_error: 0,
    payload_too_large: 0,
    unknown: 0,
  };

  let totalReplayed = 0;

  for (const e of entries) {
    byCategory[e.failureCategory] = (byCategory[e.failureCategory] ?? 0) + 1;
    if (e.replayCount > 0) totalReplayed++;
  }

  return {
    total: entries.length,
    byCategory,
    totalReplayed,
    pendingReplay: entries.length - totalReplayed,
  };
}
