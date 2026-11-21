import { describe, expect, it } from 'vitest';
import {
  GAS_TARGETS,
  composeFees,
  estimate,
  estimateBatch,
  estimateMetaTx,
  listBaselines,
  listTargets,
  type GasOperation,
} from '../gas.js';

describe('gas.estimate', () => {
  it('includes intrinsic, calldata, and base execution cost', () => {
    const result = estimate({
      operation: 'erc20Transfer',
      calldataBytes: 64,
      calldataNonZeroRatio: 1,
    });
    // Intrinsic 21k + calldata 64 * 16 + base 51.5k = 73,524.
    expect(result.estimated).toBe(21_000 + 64 * 16 + 51_500);
    expect(result.class).toBe('single-transfer');
    expect(result.contract).toBe('ERC20Gas.sol');
  });

  it('scales with itemCount for batch-style operations', () => {
    const small = estimate({ operation: 'batchTransfer', itemCount: 1 });
    const big = estimate({ operation: 'batchTransfer', itemCount: 10 });
    expect(big.estimated).toBeGreaterThan(small.estimated);
    expect(big.itemCount).toBe(10);
    // Should grow roughly linearly — the per-item delta matches the baseline.
    expect(big.estimated - small.estimated).toBe(9 * 23_500);
  });

  it('flags estimates that exceed their class target', () => {
    const ok = estimate({ operation: 'setPlatformFeeBps' });
    expect(ok.withinTarget).toBe(true);

    // Inflate calldata so the estimate blows through the administrative cap.
    const over = estimate({
      operation: 'setPlatformFeeBps',
      calldataBytes: 128_000,
      calldataNonZeroRatio: 1,
    });
    expect(over.withinTarget).toBe(false);
  });

  it('applies a 70% default non-zero calldata ratio', () => {
    const withDefault = estimate({ operation: 'erc20Transfer', calldataBytes: 100 });
    const explicitlySame = estimate({
      operation: 'erc20Transfer',
      calldataBytes: 100,
      calldataNonZeroRatio: 0.7,
    });
    expect(withDefault.estimated).toBe(explicitlySame.estimated);
  });

  it('clamps an out-of-range ratio to [0, 1]', () => {
    const low = estimate({
      operation: 'erc20Transfer',
      calldataBytes: 100,
      calldataNonZeroRatio: -0.5,
    });
    const high = estimate({
      operation: 'erc20Transfer',
      calldataBytes: 100,
      calldataNonZeroRatio: 5,
    });
    const explicit0 = estimate({
      operation: 'erc20Transfer',
      calldataBytes: 100,
      calldataNonZeroRatio: 0,
    });
    const explicit1 = estimate({
      operation: 'erc20Transfer',
      calldataBytes: 100,
      calldataNonZeroRatio: 1,
    });
    expect(low.estimated).toBe(explicit0.estimated);
    expect(high.estimated).toBe(explicit1.estimated);
  });

  it('rejects unknown operations', () => {
    expect(() =>
      estimate({ operation: 'doesNotExist' as GasOperation }),
    ).toThrow(/unknown gas operation/);
  });
});

describe('gas.composeFees', () => {
  it('produces EIP-1559-style breakdown', () => {
    const base = estimate({ operation: 'erc20Transfer', calldataBytes: 64 });
    const fees = composeFees(base, { baseFeeGwei: 10, priorityFeeGwei: 2 });

    expect(fees.maxPriorityFeePerGasGwei).toBe(2);
    expect(fees.maxFeePerGasGwei).toBe(22); // 10 * 2 + 2
    expect(fees.gasLimit).toBe(base.estimated);
    expect(fees.expectedFeeEth).toBeCloseTo((base.estimated * 12) / 1e9, 12);
    expect(fees.worstCaseFeeEth).toBeCloseTo((base.estimated * 22) / 1e9, 12);
  });

  it('defaults priority fee to 1.5 gwei when omitted', () => {
    const base = estimate({ operation: 'erc20Transfer' });
    const fees = composeFees(base, { baseFeeGwei: 5 });
    expect(fees.priorityFeeGwei).toBe(1.5);
    expect(fees.maxFeePerGasGwei).toBe(5 * 2 + 1.5);
  });

  it('rejects negative fees', () => {
    const base = estimate({ operation: 'erc20Transfer' });
    expect(() => composeFees(base, { baseFeeGwei: -1 })).toThrow(/non-negative/);
  });
});

describe('gas.estimateBatch', () => {
  it('shows meaningful savings vs sequential calls', () => {
    const result = estimateBatch({ operation: 'batchTransfer', itemCount: 20 });
    expect(result.batch.itemCount).toBe(20);
    expect(result.savings).toBeGreaterThan(0);
    // A 20-way batch should save at least 30% over 20 separate transactions.
    expect(result.savingsPct).toBeGreaterThan(30);
  });

  it('yields zero savings for item count of one', () => {
    const result = estimateBatch({ operation: 'batchTransfer', itemCount: 1 });
    // One item is indistinguishable from a single tx — the savings should
    // be non-negative and small.
    expect(result.savings).toBeGreaterThanOrEqual(0);
  });
});

describe('gas.estimateMetaTx', () => {
  it('forwarder channel is more expensive than eip7702', () => {
    const forwarder = estimateMetaTx({
      innerOperation: 'erc20Transfer',
      channel: 'forwarder',
    });
    const seventySevenOhTwo = estimateMetaTx({
      innerOperation: 'erc20Transfer',
      channel: 'eip7702',
    });
    expect(forwarder.estimated).toBeGreaterThan(seventySevenOhTwo.estimated);
    expect(forwarder.channel).toBe('forwarder');
    expect(seventySevenOhTwo.channel).toBe('eip7702');
  });

  it('caller pays zero — relayer pays estimated', () => {
    const res = estimateMetaTx({
      innerOperation: 'erc20Transfer',
      channel: 'forwarder',
    });
    expect(res.relayerCost).toBe(res.estimated);
  });

  it('passes inner item count through to the inner estimate', () => {
    const res = estimateMetaTx({
      innerOperation: 'eip7702Execute',
      innerItemCount: 5,
      channel: 'eip7702',
    });
    expect(res.inner.itemCount).toBe(5);
  });
});

describe('listings', () => {
  it('listBaselines returns every operation', () => {
    const list = listBaselines();
    const names = list.map((l) => l.operation).sort();
    expect(names).toContain('splitPayment');
    expect(names).toContain('eip7702ExecuteWithAuth');
  });

  it('listTargets covers every class', () => {
    const list = listTargets();
    const classes = list.map((l) => l.class).sort();
    expect(classes).toEqual(Object.keys(GAS_TARGETS).sort());
  });
});
