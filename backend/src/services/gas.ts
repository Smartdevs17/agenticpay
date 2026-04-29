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
  // gas * (gwei * 1e-9) / 1e18 ETH — we return the raw ETH value as a
  // Number because gas * gwei well below 2^53 for realistic inputs.
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
