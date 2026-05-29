import type { StoredEvent } from './event-types.js';

export interface DeadLetterEntry {
  id: string;
  event: StoredEvent;
  handlerName: string;
  error: string;
  failedAt: string;
  retryCount: number;
  lastRetryAt: string | null;
  resolvedAt: string | null;
}

const queue: DeadLetterEntry[] = [];
let nextId = 1;

export function addToDeadLetterQueue(
  event: StoredEvent,
  handlerName: string,
  error: unknown,
  retryCount = 0
): DeadLetterEntry {
  const entry: DeadLetterEntry = {
    id: `dlq-${nextId++}`,
    event,
    handlerName,
    error: error instanceof Error ? error.message : String(error),
    failedAt: new Date().toISOString(),
    retryCount,
    lastRetryAt: retryCount > 0 ? new Date().toISOString() : null,
    resolvedAt: null,
  };
  queue.push(entry);
  return entry;
}

export function getDeadLetterQueue(): DeadLetterEntry[] {
  return queue.filter((e) => e.resolvedAt === null);
}

export function getAllDeadLetterEntries(): DeadLetterEntry[] {
  return [...queue];
}

export function resolveDeadLetterEntry(id: string): boolean {
  const entry = queue.find((e) => e.id === id);
  if (!entry || entry.resolvedAt !== null) return false;
  entry.resolvedAt = new Date().toISOString();
  return true;
}

export function getDeadLetterStats() {
  const unresolved = queue.filter((e) => e.resolvedAt === null);
  const byHandler: Record<string, number> = {};
  for (const e of unresolved) {
    byHandler[e.handlerName] = (byHandler[e.handlerName] ?? 0) + 1;
  }
  return {
    total: queue.length,
    unresolved: unresolved.length,
    byHandler,
  };
}

/** Removes resolved entries older than `maxAgeMs` to bound memory growth. */
export function purgeResolvedEntries(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  const before = queue.length;
  const kept = queue.filter(
    (e) => e.resolvedAt === null || new Date(e.resolvedAt).getTime() > cutoff
  );
  queue.length = 0;
  queue.push(...kept);
  return before - kept.length;
}
