/** In-memory replay protection; swap for Redis in multi-instance deploys. */
const seenEventIds = new Map<string, number>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function isReplayEvent(eventId: string, ttlMs = DEFAULT_TTL_MS): boolean {
  const now = Date.now();
  pruneExpired(now, ttlMs);
  if (seenEventIds.has(eventId)) {
    return true;
  }
  seenEventIds.set(eventId, now + ttlMs);
  return false;
}

function pruneExpired(now: number, ttlMs: number): void {
  for (const [id, expires] of seenEventIds) {
    if (expires < now) {
      seenEventIds.delete(id);
    }
  }
  if (seenEventIds.size > 10_000) {
    const cutoff = now - ttlMs;
    for (const [id, expires] of seenEventIds) {
      if (expires < cutoff) seenEventIds.delete(id);
    }
  }
}

export function clearReplayCache(): void {
  seenEventIds.clear();
}
