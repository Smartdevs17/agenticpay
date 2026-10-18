import { describe, expect, it } from 'vitest';
import {
  NANO_CONFIG,
  NanoSettleRail,
  createNanoSettleRail,
  isValidNanoAddress,
  rawToXno,
  resolveSettlementRail,
  xnoToRaw,
} from '../nano-settle-rail.js';

const PAYER = 'nano_3111111111111111111111111111111111111111111111111111hifc8npp';
const PAYEE = 'nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3';
const OTHER = 'nano_1t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3';
const NOW = 1_700_000_000_000;

function buildRail(): NanoSettleRail {
  return createNanoSettleRail({ now: () => NOW });
}

describe('Nano address and amount helpers (#1004)', () => {
  it('validates nano_ and xrb_ addresses', () => {
    expect(isValidNanoAddress(PAYER)).toBe(true);
    expect(isValidNanoAddress(PAYEE)).toBe(true);
    expect(isValidNanoAddress(`xrb_${PAYEE.slice(5)}`)).toBe(true);
    expect(isValidNanoAddress('nano_short')).toBe(false);
    expect(isValidNanoAddress(PAYER.slice(0, -1))).toBe(false);
    expect(isValidNanoAddress('btc_1111111111111111111111111111111111111111111111111111hifc8npp')).toBe(false);
  });

  it('converts XNO to raw and back', () => {
    expect(xnoToRaw(1)).toBe(NANO_CONFIG.rawPerXno);
    expect(xnoToRaw(0)).toBe(0n);
    expect(rawToXno(NANO_CONFIG.rawPerXno)).toBe(1);
    expect(rawToXno(xnoToRaw(12.345))).toBeCloseTo(12.345, 10);
  });

  it('rejects invalid amounts', () => {
    expect(() => xnoToRaw(-1)).toThrow(/invalid/i);
    expect(() => xnoToRaw(Number.NaN)).toThrow(/invalid/i);
  });

  it('resolves the settlement rail per asset', () => {
    expect(resolveSettlementRail('XNO')).toBe('nano');
    expect(resolveSettlementRail('xno')).toBe('nano');
    expect(resolveSettlementRail('USDC')).toBe('stellar');
  });
});

describe('Nano escrow hold (#1004)', () => {
  it('holds funds as one feeless send', () => {
    const rail = buildRail();
    rail.fundAccount(PAYER, 10);

    const escrow = rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 4, escrowId: 'esc_1' });

    expect(escrow.status).toBe('held');
    expect(escrow.amountXno).toBe(4);
    expect(escrow.holdBlock.type).toBe('send');
    expect(escrow.holdBlock.feeless).toBe(true);
    expect(escrow.holdBlock.link).toBe(escrow.escrowAccount);
    expect(escrow.holdBlock.amountXno).toBe(4);
    expect(rail.getBalanceXno(PAYER)).toBe(6);
    expect(rail.getBalanceXno(escrow.escrowAccount)).toBe(4);
  });

  it('rejects a hold when the payer has insufficient balance', () => {
    const rail = buildRail();
    rail.fundAccount(PAYER, 1);
    expect(() => rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 5 })).toThrow(/insufficient/i);
  });

  it('rejects invalid addresses and amounts', () => {
    const rail = buildRail();
    rail.fundAccount(PAYER, 10);
    expect(() => rail.holdEscrow({ payer: 'not-an-address', payee: PAYEE, amountXno: 1 })).toThrow(/invalid payer/i);
    expect(() => rail.holdEscrow({ payer: PAYER, payee: 'nope', amountXno: 1 })).toThrow(/invalid payee/i);
    expect(() => rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 0 })).toThrow(/greater than zero/i);
  });

  it('replays an idempotency key instead of holding twice', () => {
    const rail = buildRail();
    rail.fundAccount(PAYER, 10);

    const first = rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 4, idempotencyKey: 'idem-1' });
    const second = rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 4, idempotencyKey: 'idem-1' });

    expect(second.id).toBe(first.id);
    expect(second.holdBlock.hash).toBe(first.holdBlock.hash);
    expect(rail.getBalanceXno(PAYER)).toBe(6);
    expect(rail.listEscrows()).toHaveLength(1);
  });

  it('rejects an idempotency key reused with different details', () => {
    const rail = buildRail();
    rail.fundAccount(PAYER, 10);
    rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 4, idempotencyKey: 'idem-1' });

    expect(() =>
      rail.holdEscrow({ payer: PAYER, payee: OTHER, amountXno: 4, idempotencyKey: 'idem-1' }),
    ).toThrow(/IDEMPOTENCY_KEY_REUSE_MISMATCH/);
  });
});

describe('Nano escrow release and refund (#1004)', () => {
  it('releases funds in one feeless block that doubles as the receipt', () => {
    const rail = buildRail();
    rail.fundAccount(PAYER, 10);
    const escrow = rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 4, escrowId: 'esc_1' });

    const released = rail.releaseEscrow('esc_1', { approvedBy: 'agent-7' });

    expect(released.status).toBe('released');
    expect(released.releaseBlock?.feeless).toBe(true);
    expect(released.releaseBlock?.link).toBe(PAYEE);
    expect(released.approvedBy).toBe('agent-7');
    expect(rail.getBalanceXno(PAYEE)).toBe(4);
    expect(rail.getBalanceXno(escrow.escrowAccount)).toBe(0);

    const receipt = rail.verifyEscrowReceipt('esc_1');
    expect(receipt.verified).toBe(true);
    expect(receipt.feeless).toBe(true);
    expect(receipt.to).toBe(PAYEE);
    expect(receipt.amountXno).toBe(4);
    expect(receipt.blockHash).toBe(released.releaseBlock?.hash);
  });

  it('is idempotent when releasing an already-released escrow', () => {
    const rail = buildRail();
    rail.fundAccount(PAYER, 10);
    rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 4, escrowId: 'esc_1' });

    const first = rail.releaseEscrow('esc_1');
    const second = rail.releaseEscrow('esc_1');

    expect(second.releaseBlock?.hash).toBe(first.releaseBlock?.hash);
    expect(rail.getBalanceXno(PAYEE)).toBe(4);
  });

  it('refunds funds back to the payer', () => {
    const rail = buildRail();
    rail.fundAccount(PAYER, 10);
    const escrow = rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 4, escrowId: 'esc_1' });

    const refunded = rail.refundEscrow('esc_1', { reason: 'milestone rejected' });

    expect(refunded.status).toBe('refunded');
    expect(refunded.refundBlock?.link).toBe(PAYER);
    expect(rail.getBalanceXno(PAYER)).toBe(10);
    expect(rail.getBalanceXno(escrow.escrowAccount)).toBe(0);
    expect((refunded.metadata as Record<string, unknown>)?.refundReason).toBe('milestone rejected');
  });

  it('refuses to release or refund escrows in the wrong state', () => {
    const rail = buildRail();
    rail.fundAccount(PAYER, 10);
    rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 4, escrowId: 'esc_1' });
    rail.refundEscrow('esc_1');

    expect(() => rail.releaseEscrow('esc_1')).toThrow(/cannot be released/i);
    expect(() => rail.releaseEscrow('missing')).toThrow(/not found/i);
  });

  it('does not verify a receipt for an unreleased escrow', () => {
    const rail = buildRail();
    rail.fundAccount(PAYER, 10);
    rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 4, escrowId: 'esc_1' });

    const receipt = rail.verifyEscrowReceipt('esc_1');
    expect(receipt.verified).toBe(false);
    expect(receipt.blockHash).toBeUndefined();
  });
});

describe('Nano rail bookkeeping (#1004)', () => {
  it('tracks escrows, metrics and blocks', () => {
    const rail = buildRail();
    rail.fundAccount(PAYER, 100);

    const held = rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 1, escrowId: 'held' });
    rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 2, escrowId: 'released' });
    rail.releaseEscrow('released');
    rail.holdEscrow({ payer: PAYER, payee: PAYEE, amountXno: 3, escrowId: 'refunded' });
    rail.refundEscrow('refunded');
    rail.holdEscrow({ payer: PAYER, payee: OTHER, amountXno: 4, escrowId: 'different-payee' });

    const metrics = rail.getMetrics();
    expect(metrics.escrows).toBe(4);
    expect(metrics.held).toBe(2);
    expect(metrics.released).toBe(1);
    expect(metrics.refunded).toBe(1);
    expect(metrics.feesCollectedRaw).toBe('0');
    expect(metrics.feesCollectedXno).toBe(0);

    expect(rail.listEscrows({ status: 'released' })).toHaveLength(1);
    expect(rail.listEscrows({ payee: OTHER })).toHaveLength(1);

    expect(rail.getBlock(held.holdBlock.hash)?.hash).toBe(held.holdBlock.hash);
    expect(rail.getBlock('deadbeef')).toBeNull();
    expect(rail.getEscrow('missing')).toBeNull();
  });
});
