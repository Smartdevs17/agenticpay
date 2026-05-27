/**
 * Per-user rate limiting for relayer submissions.
 * Separate from the global API rate limiter — enforces relay-specific quotas.
 */

interface RateLimitState {
  count: number;
  resetAtMs: number;
}

const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_RELAYS_PER_WINDOW = 10; // per user

const store = new Map<string, RateLimitState>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

export function checkRelayRateLimit(signerAddress: string): RateLimitResult {
  const now = Date.now();
  const existing = store.get(signerAddress);

  const state: RateLimitState =
    !existing || existing.resetAtMs <= now
      ? { count: 0, resetAtMs: now + WINDOW_MS }
      : existing;

  state.count += 1;
  store.set(signerAddress, state);

  const remaining = Math.max(0, MAX_RELAYS_PER_WINDOW - state.count);
  const resetInSeconds = Math.ceil((state.resetAtMs - now) / 1000);

  return {
    allowed: state.count <= MAX_RELAYS_PER_WINDOW,
    remaining,
    resetInSeconds,
  };
}
