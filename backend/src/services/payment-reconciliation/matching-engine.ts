// matching-engine.ts — Issue #628
//
// Deterministic, DB-free payment matching algorithm shared by the
// reconciliation service. Given two pools of records — "internal" (our own
// Payment ledger) and "external" (a bank statement, PSP settlement file, or
// on-chain feed) — it produces:
//
//   1. Exact matches   — same currency AND (matching external reference /
//      tx hash, OR identical amount within a tight date window). Confidence
//      is always 1.0.
//   2. Fuzzy matches    — same currency, amount within a configurable
//      tolerance percentage, occurred-at within a wider date window.
//      Confidence is a weighted blend of how close the amount and the date
//      are to exact, and a match is only accepted once confidence clears
//      `minFuzzyConfidence`.
//   3. Unmatched records on both sides — surfaced as reconciliation
//      exceptions by the caller.
//
// The engine never matches across currencies, never matches an amount whose
// delta exceeds the configured tolerance, and never reuses a record once it
// has been claimed by an earlier (higher-priority) pass — each record is
// claimed by at most one match. Partial / split-payment matching (one
// record against the sum of several counterparts) is intentionally not
// supported; such records are left unmatched so they surface as exceptions
// for manual review.

export type ReconciliationSource = 'internal' | 'bank_statement' | 'psp_settlement' | 'onchain';
export type MatchType = 'exact' | 'fuzzy' | 'manual';

/** A record from either pool, normalized for the matching algorithm. */
export interface MatchCandidate {
  /** Caller-assigned id used to correlate results back to source records. */
  id: string;
  source: ReconciliationSource;
  /** External reference / tx hash used for exact reference matching. */
  externalRef?: string | null;
  paymentId?: string | null;
  amount: number;
  currency: string;
  occurredAt: Date;
}

export interface MatchResult {
  internalId: string;
  externalId: string;
  matchType: Exclude<MatchType, 'manual'>;
  /** 0..1 confidence score. Always 1 for exact matches. */
  confidence: number;
  /** external.amount - internal.amount */
  amountDelta: number;
}

export interface MatchingOptions {
  /** Fuzzy amount tolerance as a fraction of the internal amount, e.g. 0.02 = 2%. */
  amountTolerancePct?: number;
  /** Date window (ms) within which same-amount records are still "exact". Default 5 minutes. */
  exactDateWindowMs?: number;
  /** Date window (ms) considered for fuzzy matching. Default 3 days. */
  fuzzyDateWindowMs?: number;
  /** Minimum confidence required to accept a fuzzy match. Default 0.5. */
  minFuzzyConfidence?: number;
}

export interface MatchingOutcome {
  matches: MatchResult[];
  unmatchedInternal: MatchCandidate[];
  unmatchedExternal: MatchCandidate[];
}

export const DEFAULT_MATCHING_OPTIONS: Required<MatchingOptions> = {
  amountTolerancePct: 0.02,
  exactDateWindowMs: 5 * 60 * 1000,
  fuzzyDateWindowMs: 3 * 24 * 60 * 60 * 1000,
  // Confidence blends amount closeness (70%) and date closeness (30%); a
  // pair sitting exactly at the amount-tolerance boundary on the same day
  // scores 0.3 (0 * 0.7 + 1 * 0.3). Default threshold sits at that floor so
  // the tolerance window — not this secondary confidence gate — is what
  // decides whether a boundary case is accepted.
  minFuzzyConfidence: 0.3,
};

const AMOUNT_EPSILON = 1e-8;

function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < AMOUNT_EPSILON;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Score in [0,1] for how close an amount delta is to zero relative to tolerance. */
function amountScoreFor(deltaPct: number, tolerancePct: number): number {
  if (deltaPct <= 0) return 1;
  if (tolerancePct <= 0) return 0;
  return clamp(1 - deltaPct / tolerancePct, 0, 1);
}

/** Score in [0,1] for how close a date delta is to zero relative to the window. */
function dateScoreFor(deltaMs: number, windowMs: number): number {
  if (deltaMs <= 0) return 1;
  if (windowMs <= 0) return 0;
  return clamp(1 - deltaMs / windowMs, 0, 1);
}

function makeMatch(
  internal: MatchCandidate,
  external: MatchCandidate,
  matchType: 'exact' | 'fuzzy',
  confidence: number,
): MatchResult {
  return {
    internalId: internal.id,
    externalId: external.id,
    matchType,
    confidence: round(confidence, 4),
    amountDelta: round(external.amount - internal.amount, 8),
  };
}

/**
 * Run the matching algorithm over two pools of records. Pure function — no
 * I/O, no DB access — so it is fully unit-testable and reusable regardless
 * of where the records came from.
 */
export function runMatchingEngine(
  internal: MatchCandidate[],
  external: MatchCandidate[],
  options: MatchingOptions = {},
): MatchingOutcome {
  const opts = { ...DEFAULT_MATCHING_OPTIONS, ...options };
  const matches: MatchResult[] = [];

  const remainingInternal = new Map(internal.map((r) => [r.id, r]));
  const remainingExternal = new Map(external.map((r) => [r.id, r]));

  // --- Pass 1: exact match by amount + currency + external reference / tx hash
  for (const int of [...remainingInternal.values()]) {
    if (!remainingInternal.has(int.id) || !int.externalRef) continue;

    const candidate = [...remainingExternal.values()].find(
      (ext) =>
        remainingExternal.has(ext.id) &&
        ext.currency === int.currency &&
        !!ext.externalRef &&
        ext.externalRef === int.externalRef &&
        amountsEqual(ext.amount, int.amount),
    );

    if (candidate) {
      matches.push(makeMatch(int, candidate, 'exact', 1));
      remainingInternal.delete(int.id);
      remainingExternal.delete(candidate.id);
    }
  }

  // --- Pass 2: exact match by identical amount within a tight date window --
  for (const int of [...remainingInternal.values()]) {
    if (!remainingInternal.has(int.id)) continue;

    const candidates = [...remainingExternal.values()]
      .filter(
        (ext) =>
          remainingExternal.has(ext.id) &&
          ext.currency === int.currency &&
          amountsEqual(ext.amount, int.amount) &&
          Math.abs(ext.occurredAt.getTime() - int.occurredAt.getTime()) <= opts.exactDateWindowMs,
      )
      .sort(
        (a, b) =>
          Math.abs(a.occurredAt.getTime() - int.occurredAt.getTime()) -
          Math.abs(b.occurredAt.getTime() - int.occurredAt.getTime()),
      );

    const candidate = candidates[0];
    if (candidate) {
      matches.push(makeMatch(int, candidate, 'exact', 1));
      remainingInternal.delete(int.id);
      remainingExternal.delete(candidate.id);
    }
  }

  // --- Pass 3: fuzzy match — build all viable pairs, assign best-first -----
  interface Pair {
    internal: MatchCandidate;
    external: MatchCandidate;
    confidence: number;
  }
  const pairs: Pair[] = [];

  for (const int of remainingInternal.values()) {
    for (const ext of remainingExternal.values()) {
      if (ext.currency !== int.currency) continue;

      const amountDelta = Math.abs(ext.amount - int.amount);
      const amountDeltaPct = int.amount === 0 ? (ext.amount === 0 ? 0 : Infinity) : amountDelta / Math.abs(int.amount);
      if (amountDeltaPct > opts.amountTolerancePct) continue;

      const dateDeltaMs = Math.abs(ext.occurredAt.getTime() - int.occurredAt.getTime());
      if (dateDeltaMs > opts.fuzzyDateWindowMs) continue;

      const amountScore = amountScoreFor(amountDeltaPct, opts.amountTolerancePct);
      const dateScore = dateScoreFor(dateDeltaMs, opts.fuzzyDateWindowMs);
      // Amount closeness matters more than date closeness for confidence.
      const confidence = amountScore * 0.7 + dateScore * 0.3;
      if (confidence < opts.minFuzzyConfidence) continue;

      pairs.push({ internal: int, external: ext, confidence });
    }
  }

  // Highest-confidence pairs win first; ties broken by smallest date delta.
  pairs.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const da = Math.abs(a.external.occurredAt.getTime() - a.internal.occurredAt.getTime());
    const db = Math.abs(b.external.occurredAt.getTime() - b.internal.occurredAt.getTime());
    return da - db;
  });

  for (const pair of pairs) {
    if (!remainingInternal.has(pair.internal.id) || !remainingExternal.has(pair.external.id)) continue;
    matches.push(makeMatch(pair.internal, pair.external, 'fuzzy', pair.confidence));
    remainingInternal.delete(pair.internal.id);
    remainingExternal.delete(pair.external.id);
  }

  return {
    matches,
    unmatchedInternal: [...remainingInternal.values()],
    unmatchedExternal: [...remainingExternal.values()],
  };
}
