/**
 * Gas estimation service.
 *
 * Keeps a registry of per-operation gas baselines (drawn from measured
 * runs of the contracts under `contracts/`, documented in
 * `contracts/gas-analysis.md`) and exposes helpers that blend those
 * baselines with EIP-1559 fee composition, batch-discount math, and
 * meta-transaction relay overhead.
 *
 * The numbers are server-side estimates — they are not a substitute for
 * `eth_estimateGas` on a real node. Consumers can still use them for
 * UI previews, queue sizing, and cost guards without waking up the RPC.
 */

export type GasOperation =
  | 'splitPayment'
  | 'setRecipient'
  | 'setPlatformFeeBps'
  | 'withdraw'
  | 'batchTransfer'
  | 'erc20Transfer'
  | 'erc20TransferFrom'
  | 'erc20Approve'
  | 'erc20BatchTransfer'
  | 'erc20Mint'
  | 'erc20Burn'
  | 'metaTxExecute'
  | 'eip7702Execute'
  | 'eip7702ExecuteWithAuth';

/** Class of function for target-gas bookkeeping. */
export type GasClass =
  | 'administrative'
  | 'single-transfer'
  | 'batch-transfer'
  | 'meta-transaction'
  | 'write-heavy';

interface BaselineEntry {
  /** Base cost: the minimum gas to dispatch the call successfully. */
  base: number;
  /** Marginal cost per calldata byte (non-zero). */
  perByte: number;
  /** Extra cost per item in batch/loop operations (0 for scalar calls). */
  perItem: number;
  /** Classification used by target checks. */
  class: GasClass;
  /** Reference contract file. */
  contract: string;
}

/**
 * Baselines are derived from the gas-analysis doc. When you tweak a
 * contract, update both the Solidity AND the entry here so consumers
 * see consistent numbers without having to redeploy to refresh
 * estimates.
 */
const BASELINES: Record<GasOperation, BaselineEntry> = {
  splitPayment:      { base: 55_000,  perByte: 0,  perItem: 15_500, class: 'write-heavy',     contract: 'SplitterOptimized.sol' },
  setRecipient:      { base: 52_000,  perByte: 0,  perItem: 0,      class: 'administrative',  contract: 'SplitterOptimized.sol' },
  setPlatformFeeBps: { base: 29_000,  perByte: 0,  perItem: 0,      class: 'administrative',  contract: 'SplitterOptimized.sol' },
  withdraw:          { base: 33_000,  perByte: 0,  perItem: 0,      class: 'administrative',  contract: 'SplitterOptimized.sol' },
  batchTransfer:     { base: 32_000,  perByte: 16, perItem: 23_500, class: 'batch-transfer',  contract: 'BatchSplitter.sol' },
  erc20Transfer:     { base: 51_500,  perByte: 0,  perItem: 0,      class: 'single-transfer', contract: 'ERC20Gas.sol' },
  erc20TransferFrom: { base: 58_000,  perByte: 0,  perItem: 0,      class: 'single-transfer', contract: 'ERC20Gas.sol' },
  erc20Approve:      { base: 46_500,  perByte: 0,  perItem: 0,      class: 'administrative',  contract: 'ERC20Gas.sol' },
  erc20BatchTransfer:{ base: 44_000,  perByte: 16, perItem: 22_000, class: 'batch-transfer',  contract: 'ERC20Gas.sol' },
  erc20Mint:         { base: 50_000,  perByte: 0,  perItem: 0,      class: 'administrative',  contract: 'ERC20Gas.sol' },
  erc20Burn:         { base: 34_000,  perByte: 0,  perItem: 0,      class: 'administrative',  contract: 'ERC20Gas.sol' },
  metaTxExecute:     { base: 72_000,  perByte: 16, perItem: 0,      class: 'meta-transaction',contract: 'MetaTxForwarder.sol' },
  eip7702Execute:    { base: 40_000,  perByte: 16, perItem: 21_500, class: 'meta-transaction',contract: 'EIP7702Delegator.sol' },
  eip7702ExecuteWithAuth: { base: 68_000, perByte: 16, perItem: 21_500, class: 'meta-transaction', contract: 'EIP7702Delegator.sol' },
};

/** Per-class soft ceilings; exposed via `GET /gas/targets`. */
export const GAS_TARGETS: Record<GasClass, number> = {
  administrative: 60_000,
  'single-transfer': 80_000,
  'batch-transfer': 450_000,
  'meta-transaction': 120_000,
  'write-heavy': 130_000,
};

/** Intrinsic cost every EVM transaction pays before running any code. */
const INTRINSIC_TX_GAS = 21_000;
/** Cost per non-zero calldata byte at EIP-1559 baseline. */
const CALLDATA_NONZERO_BYTE = 16;
/** Cost per zero calldata byte. */
const CALLDATA_ZERO_BYTE = 4;

export interface EstimateInput {
  operation: GasOperation;
  itemCount?: number;
  calldataBytes?: number;
  /** Relative share of `calldataBytes` that is non-zero (default 70%). */
  calldataNonZeroRatio?: number;
}

export interface GasEstimate {
  operation: GasOperation;
  class: GasClass;
  contract: string;
  base: number;
  perByte: number;
  perItem: number;
  itemCount: number;
  calldataBytes: number;
  intrinsic: number;
  estimated: number;
  target: number;
  withinTarget: boolean;
}

export function estimate(input: EstimateInput): GasEstimate {
  const baseline = BASELINES[input.operation];
  if (!baseline) {
    throw new Error(`unknown gas operation: ${input.operation}`);
  }

  const itemCount = Math.max(0, input.itemCount ?? 0);
  const calldataBytes = Math.max(0, input.calldataBytes ?? 0);
  const ratio = clamp01(input.calldataNonZeroRatio ?? 0.7);
  const nonZero = Math.round(calldataBytes * ratio);
  const zero = calldataBytes - nonZero;

  const calldataCost = nonZero * CALLDATA_NONZERO_BYTE + zero * CALLDATA_ZERO_BYTE;
  const itemCost = baseline.perItem * itemCount;

  const execution = baseline.base + itemCost + baseline.perByte * calldataBytes;
  const estimated = INTRINSIC_TX_GAS + calldataCost + execution;

  const target = GAS_TARGETS[baseline.class];

  return {
    operation: input.operation,
    class: baseline.class,
    contract: baseline.contract,
    base: baseline.base,
    perByte: baseline.perByte,
    perItem: baseline.perItem,
    itemCount,
    calldataBytes,
    intrinsic: INTRINSIC_TX_GAS + calldataCost,
    estimated,
    target: target + itemCost, // batch targets scale with N items
    withinTarget: estimated <= target + itemCost,
  };
}

export interface FeeInput {
  baseFeeGwei: number;
  priorityFeeGwei?: number;
}

export interface FeeBreakdown {
  baseFeeGwei: number;
  priorityFeeGwei: number;
  maxFeePerGasGwei: number;
  maxPriorityFeePerGasGwei: number;
  gasLimit: number;
  /** Expected fee in ETH (×10^-18), using base + priority. */
  expectedFeeEth: number;
  /** Worst-case fee in ETH, using max caps. */
  worstCaseFeeEth: number;
}

export function composeFees(estimateResult: GasEstimate, fee: FeeInput): FeeBreakdown {
  const base = assertNonNegative(fee.baseFeeGwei, 'baseFeeGwei');
  const priority = assertNonNegative(fee.priorityFeeGwei ?? 1.5, 'priorityFeeGwei');
  const maxFee = base * 2 + priority; // standard EIP-1559 safety cap

  return {
    baseFeeGwei: base,
    priorityFeeGwei: priority,
    maxFeePerGasGwei: maxFee,
    maxPriorityFeePerGasGwei: priority,
    gasLimit: estimateResult.estimated,
    expectedFeeEth: gweiGasToEth(base + priority, estimateResult.estimated),
    worstCaseFeeEth: gweiGasToEth(maxFee, estimateResult.estimated),
  };
}

export interface BatchInput {
  operation: GasOperation;
  itemCount: number;
  calldataBytes?: number;
}

export interface BatchEstimate {
  batch: GasEstimate;
  sequentialEstimated: number;
  savings: number;
  savingsPct: number;
}

export function estimateBatch(input: BatchInput): BatchEstimate {
  const batch = estimate({
    operation: input.operation,
    itemCount: input.itemCount,
    calldataBytes: input.calldataBytes,
  });

  const perItem = BASELINES[input.operation].perItem;
  const singleCost = INTRINSIC_TX_GAS + BASELINES[input.operation].base + perItem;
  const sequentialEstimated = singleCost * Math.max(1, input.itemCount);

  const savings = Math.max(0, sequentialEstimated - batch.estimated);
  const savingsPct =
    sequentialEstimated === 0 ? 0 : (savings / sequentialEstimated) * 100;

  return { batch, sequentialEstimated, savings, savingsPct };
}

export interface MetaTxInput {
  innerOperation: GasOperation;
  innerItemCount?: number;
  innerCalldataBytes?: number;
  /** Whether the relayer uses an EIP-7702 delegator (cheaper) or a classic
   *  ERC-2771 forwarder. */
  channel: 'forwarder' | 'eip7702';
}

export interface MetaTxEstimate {
  inner: GasEstimate;
  channel: MetaTxInput['channel'];
  relayOverhead: number;
  estimated: number;
  /** Cost the relayer can expect to pay; the user pays nothing. */
  relayerCost: number;
}

export function estimateMetaTx(input: MetaTxInput): MetaTxEstimate {
  const inner = estimate({
    operation: input.innerOperation,
    itemCount: input.innerItemCount,
    calldataBytes: input.innerCalldataBytes,
  });

  const channel = input.channel;
  const overhead = channel === 'forwarder'
    ? BASELINES.metaTxExecute.base + CALLDATA_NONZERO_BYTE * 260 // ~260 bytes EIP-712 payload
    : BASELINES.eip7702Execute.base;

  // Under 7702 the inner call borrows the EOA's storage, so intrinsic
  // is counted once on the outer tx — we don't double-count it for the
  // inner estimate.
  const innerBody = inner.estimated - INTRINSIC_TX_GAS;
  const estimated = INTRINSIC_TX_GAS + overhead + innerBody;

  return {
    inner,
    channel,
    relayOverhead: overhead,
    estimated,
    relayerCost: estimated,
  };
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.7;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function assertNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}

function gweiGasToEth(gasPriceGwei: number, gas: number): number {
  // ETH = gas_units × gas_price_gwei × 1e9 (wei/gwei) / 1e18 (wei/ETH)
  //     = gas_units × gas_price_gwei / 1e9
  return (gas * gasPriceGwei) / 1e9;
}

/** Handy listing for `GET /gas/benchmarks`. */
export function listBaselines() {
  return (Object.keys(BASELINES) as GasOperation[]).map((op) => ({
    operation: op,
    ...BASELINES[op],
  }));
}

/** Handy listing for `GET /gas/targets`. */
export function listTargets() {
  return Object.entries(GAS_TARGETS).map(([className, target]) => ({
    class: className as GasClass,
    target,
  }));
}

/* ------------------------------------------------------------------ */
/* Historical gas price analysis                                       */
/* ------------------------------------------------------------------ */

export interface GasPriceSample {
  baseFeeGwei: number;
  timestamp: number;
  blockNumber?: number;
}

export interface GasPriceStats {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  min: number;
  max: number;
  sampleCount: number;
  windowMs: number;
}

export interface GasPriceRecommendation {
  speed: 'fast' | 'standard' | 'slow';
  baseFeeGwei: number;
  maxFeeGwei: number;
  maxPriorityFeeGwei: number;
  estimatedWaitBlocks: number;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Rolling in-memory store of EVM base-fee samples.
 *
 * Consumers push samples via `recordGasSample` and query optimised
 * recommendations via `recommendGasPrice`.  The store is bounded to
 * `maxSamples` entries (FIFO eviction) so memory usage is predictable.
 */
class GasPriceHistory {
  private samples: GasPriceSample[] = [];
  private readonly maxSamples: number;
  /** Samples older than this are excluded from analysis. */
  private readonly windowMs: number;

  constructor(maxSamples = 200, windowMs = 60 * 60 * 1000 /* 1 hour */) {
    this.maxSamples = maxSamples;
    this.windowMs = windowMs;
  }

  /** Add a new base-fee observation. */
  record(sample: GasPriceSample): void {
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  /** Return samples within the analysis window. */
  private recent(): GasPriceSample[] {
    const cutoff = Date.now() - this.windowMs;
    return this.samples.filter((s) => s.timestamp >= cutoff);
  }

  /** Compute descriptive statistics over the recent window. */
  stats(): GasPriceStats {
    const recent = this.recent();
    if (recent.length === 0) {
      return { p10: 0, p50: 0, p90: 0, mean: 0, min: 0, max: 0, sampleCount: 0, windowMs: this.windowMs };
    }

    const fees = recent.map((s) => s.baseFeeGwei).sort((a, b) => a - b);
    const mean = fees.reduce((a, b) => a + b, 0) / fees.length;

    return {
      p10: percentile(fees, 10),
      p50: percentile(fees, 50),
      p90: percentile(fees, 90),
      mean,
      min: fees[0],
      max: fees[fees.length - 1],
      sampleCount: fees.length,
      windowMs: this.windowMs,
    };
  }

  /**
   * Return gas price recommendations for three confirmation speeds.
   *
   * The algorithm:
   *  - `fast`     → p90 base fee + 2 Gwei priority tip (targets next block)
   *  - `standard` → p50 base fee + 1.5 Gwei priority tip (1-3 blocks)
   *  - `slow`     → p10 base fee + 1 Gwei priority tip (may take many blocks)
   *
   * EIP-1559 `maxFeePerGas` is set to `2 × baseFee + priorityFee` which
   * provides a safety buffer for base-fee spikes while capping overpayment.
   *
   * Confidence is `high` when ≥ 20 samples are available, `medium` for
   * 5-19, and `low` below 5.
   */
  recommend(): GasPriceRecommendation[] {
    const s = this.stats();
    const confidence: GasPriceRecommendation['confidence'] =
      s.sampleCount >= 20 ? 'high' : s.sampleCount >= 5 ? 'medium' : 'low';

    // Fall back to a sensible default when history is empty.
    const base = s.sampleCount === 0 ? 10 : undefined;

    const configs: Array<{
      speed: GasPriceRecommendation['speed'];
      baseFee: number;
      priority: number;
      waitBlocks: number;
    }> = [
      { speed: 'fast',     baseFee: base ?? s.p90, priority: 2.0, waitBlocks: 1 },
      { speed: 'standard', baseFee: base ?? s.p50, priority: 1.5, waitBlocks: 3 },
      { speed: 'slow',     baseFee: base ?? s.p10, priority: 1.0, waitBlocks: 10 },
    ];

    return configs.map(({ speed, baseFee, priority, waitBlocks }) => ({
      speed,
      baseFeeGwei: round2(baseFee),
      maxFeeGwei: round2(baseFee * 2 + priority),
      maxPriorityFeeGwei: priority,
      estimatedWaitBlocks: waitBlocks,
      confidence,
    }));
  }

  /**
   * Detect whether the network is currently in a fee surge.
   *
   * A surge is declared when the most recent sample's base fee exceeds
   * the p75 of the analysis window by more than `surgeThresholdPct`
   * percent (default 50%).
   */
  isSurging(surgeThresholdPct = 50): boolean {
    const recent = this.recent();
    if (recent.length < 2) return false;
    const latest = recent[recent.length - 1].baseFeeGwei;
    const fees = recent.map((s) => s.baseFeeGwei).sort((a, b) => a - b);
    const p75 = percentile(fees, 75);
    return latest > p75 * (1 + surgeThresholdPct / 100);
  }

  /** Return all stored samples (for export / debugging). */
  getSamples(): GasPriceSample[] {
    return [...this.samples];
  }
}

/* ------------------------------------------------------------------ */
/* Stuck-transaction replacement (EVM)                                 */
/* ------------------------------------------------------------------ */

export interface StuckTxReplacementInput {
  /** Original maxFeePerGas in Gwei. */
  originalMaxFeeGwei: number;
  /** Original maxPriorityFeePerGas in Gwei. */
  originalPriorityFeeGwei: number;
  /** How many blocks the transaction has been pending. */
  pendingBlocks: number;
}

export interface StuckTxReplacementResult {
  newMaxFeeGwei: number;
  newPriorityFeeGwei: number;
  bumpFactor: number;
  reason: string;
}

/**
 * Compute replacement fees for a stuck EVM transaction.
 *
 * EIP-1559 replacement rules require the new `maxFeePerGas` and
 * `maxPriorityFeePerGas` to each be at least 10% higher than the
 * original (the minimum miner-enforced bump).  We apply a larger bump
 * when the transaction has been pending for many blocks to improve the
 * chance of inclusion.
 *
 * Bump schedule:
 *  - pending < 5 blocks  → 1.15× (just above the 10% minimum)
 *  - pending 5-20 blocks → 1.30×
 *  - pending > 20 blocks → 1.50× (aggressive replacement)
 */
export function computeEvmReplacementFee(
  input: StuckTxReplacementInput,
): StuckTxReplacementResult {
  const { originalMaxFeeGwei, originalPriorityFeeGwei, pendingBlocks } = input;

  const bumpFactor =
    pendingBlocks < 5 ? 1.15 :
    pendingBlocks < 20 ? 1.30 :
    1.50;

  const newMaxFeeGwei = round2(originalMaxFeeGwei * bumpFactor);
  const newPriorityFeeGwei = round2(originalPriorityFeeGwei * bumpFactor);

  const reason =
    pendingBlocks < 5
      ? 'Minimal bump (10% above minimum replacement threshold)'
      : pendingBlocks < 20
      ? 'Moderate bump (transaction pending 5-20 blocks)'
      : 'Aggressive bump (transaction pending >20 blocks)';

  return { newMaxFeeGwei, newPriorityFeeGwei, bumpFactor, reason };
}

/* ------------------------------------------------------------------ */
/* Singleton & module-level helpers                                    */
/* ------------------------------------------------------------------ */

/** Module-level singleton for the EVM gas price history store. */
export const gasPriceHistory = new GasPriceHistory();

/**
 * Record a new EVM base-fee sample.
 * Call this after each block or after fetching `eth_feeHistory`.
 */
export function recordGasSample(sample: GasPriceSample): void {
  gasPriceHistory.record(sample);
}

/**
 * Return gas price recommendations based on historical analysis.
 * Returns three entries: fast / standard / slow.
 */
export function recommendGasPrice(): GasPriceRecommendation[] {
  return gasPriceHistory.recommend();
}

/**
 * Return descriptive statistics for the recent fee window.
 */
export function getGasPriceStats(): GasPriceStats {
  return gasPriceHistory.stats();
}

/**
 * Return true when the network appears to be in a fee surge.
 */
export function isGasSurging(): boolean {
  return gasPriceHistory.isSurging();
}

/* ------------------------------------------------------------------ */
/* Additional internals                                                */
/* ------------------------------------------------------------------ */

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[idx];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
