/**
 * Webhook deduplication by provider event ID (#1020).
 *
 * When a payment provider retries a webhook (due to timeout, network error,
 * or its own retry policy), the same event arrives multiple times. Without
 * deduplication, each retry triggers a fresh processing run — double-charging
 * customers, sending duplicate notifications, or corrupting state.
 *
 * This module tracks processed event IDs and ignores duplicates within a
 * configurable retention window.
 */

/** In-memory processed-event store; swap for Redis/DB in multi-instance deploys. */
const processedEvents = new Map<string, number>();

/** How long to retain processed event IDs (default: 24 hours). */
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Maximum entries to retain before aggressive pruning. */
const MAX_ENTRIES = 50_000;

/**
 * Check whether an event has already been processed.
 * Returns true if this is a duplicate (should be ignored).
 */
export function isDuplicateEvent(
  provider: string,
  eventId: string,
  retentionMs: number = DEFAULT_RETENTION_MS
): boolean {
  const key = `${provider}:${eventId}`;
  const now = Date.now();

  pruneExpired(now, retentionMs);

  if (processedEvents.has(key)) {
    return true;
  }

  processedEvents.set(key, now + retentionMs);
  return false;
}

/**
 * Mark an event as processed (called after successful handling).
 */
export function markEventProcessed(
  provider: string,
  eventId: string,
  retentionMs: number = DEFAULT_RETENTION_MS
): void {
  const key = `${provider}:${eventId}`;
  processedEvents.set(key, Date.now() + retentionMs);
}

/**
 * Check if an event was already processed without marking it.
 */
export function wasEventProcessed(provider: string, eventId: string): boolean {
  return processedEvents.has(`${provider}:${eventId}`);
}

function pruneExpired(now: number, retentionMs: number): void {
  for (const [id, expires] of processedEvents) {
    if (expires < now) {
      processedEvents.delete(id);
    }
  }
  if (processedEvents.size > MAX_ENTRIES) {
    const cutoff = now - retentionMs;
    for (const [id, expires] of processedEvents) {
      if (expires < cutoff) processedEvents.delete(id);
    }
  }
}

/** Clear the processed-event cache (for testing). */
export function clearProcessedEvents(): void {
  processedEvents.clear();
}

/** Get the count of tracked events (for monitoring). */
export function getProcessedEventCount(): number {
  return processedEvents.size;
}
