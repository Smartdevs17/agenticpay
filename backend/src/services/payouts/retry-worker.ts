import { payoutEngine, type PayoutEngine } from './payout-engine.js';

/** How often failed payout batches are checked for a due retry. */
export const DEFAULT_PAYOUT_RETRY_INTERVAL_MS = 60_000;

export interface PayoutRetryWorker {
  /** Runs one retry pass now. Resolves to the number of batches retried; never rejects. */
  tick(): Promise<number>;
  stop(): void;
}

/**
 * Drives `retryDueBatches` on an interval. Without this, a failed batch's backoff
 * timestamp is recorded but nothing acts on it until an operator calls the retries route.
 *
 * Passes never overlap: if a pass is still running when the next interval fires, that
 * tick is skipped. A rejected pass is reported and retried on the next interval.
 */
export function startPayoutRetryWorker(
  engine: Pick<PayoutEngine, 'retryDueBatches'> = payoutEngine,
  intervalMs: number = DEFAULT_PAYOUT_RETRY_INTERVAL_MS,
): PayoutRetryWorker {
  let running = false;

  const tick = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    try {
      const retried = await engine.retryDueBatches();
      return retried.length;
    } catch (error) {
      console.error('[payouts] Retry pass failed', error);
      return 0;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  // Do not keep the process alive solely for payout retries.
  timer.unref();

  return {
    tick,
    stop: () => clearInterval(timer),
  };
}
