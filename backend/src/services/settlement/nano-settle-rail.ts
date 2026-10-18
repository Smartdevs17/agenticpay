/**
 * Nano (XNO) Settle Rail — Issue #1004
 *
 * Adds a feeless Nano settle rail beside the Stellar/Soroban escrow path. On
 * Nano a "hold then release" is two feeless sends: no smart-contract execution,
 * no gas, no submission fee, and the release block is final in roughly a second.
 * Because the ledger itself is the public receipt, anyone can verify the release
 * block (destination, amount, ordering) without trusting either party.
 *
 * This module models that two-block flow:
 *
 *   hold:    payer  --(feeless send)-->  escrow/agent account
 *   release: escrow --(feeless send)-->  payee        (one block = confirmation)
 *
 * Block hashes and signatures are deterministic simulations so the rail can be
 * unit tested offline. Wire `NanoSettleRail` to a Nano RPC node to broadcast the
 * real `block_create` / `process` calls.
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';

export type NanoBlockType = 'send' | 'receive';
export type NanoEscrowStatus = 'held' | 'released' | 'refunded' | 'expired';

export interface NanoBlock {
  hash: string;
  type: NanoBlockType;
  /** Account that owns/creates the block. */
  account: string;
  /** Previous block hash, or 64 zeros for an account's first block. */
  previous: string;
  representative: string;
  /** Resulting account balance in raw, as a decimal string. */
  balance: string;
  /** For a send: destination address. For a receive: source block hash. */
  link: string;
  signature: string;
  amountRaw: string;
  amountXno: number;
  timestamp: string;
  /** Nano transfers carry no fee. */
  feeless: true;
  /** Time to confirmation, in milliseconds (one confirmation ≈ 1s). */
  finalityMs: number;
  confirmed: true;
}

export interface NanoEscrow {
  id: string;
  payer: string;
  payee: string;
  escrowAccount: string;
  representative: string;
  amountXno: number;
  amountRaw: string;
  status: NanoEscrowStatus;
  holdBlock: NanoBlock;
  releaseBlock?: NanoBlock;
  refundBlock?: NanoBlock;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  releasedAt?: string;
  refundedAt?: string;
  approvedBy?: string;
}

export interface HoldEscrowInput {
  payer: string;
  payee: string;
  amountXno: number;
  representative?: string;
  escrowId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface NanoRailConfig {
  /** Default representative used when a caller does not supply one. */
  representative?: string;
  /** Account (or agent) that custodies held funds. */
  escrowAccount?: string;
  /** Simulated confirmation time in milliseconds. */
  finalityMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export interface NanoReceiveVerification {
  escrowId: string;
  status: NanoEscrowStatus;
  blockHash?: string;
  to?: string;
  amountXno?: number;
  feeless: true;
  finalityMs: number;
  /** True once the release send is included in the ledger. */
  verified: boolean;
  explorerHint: string;
}

export interface NanoRailMetrics {
  escrows: number;
  held: number;
  released: number;
  refunded: number;
  feesCollectedRaw: '0';
  feesCollectedXno: 0;
}

export const NANO_CONFIG = {
  ticker: 'XNO',
  decimals: 30,
  rawPerXno: 10n ** 30n,
  /** Nano's reference representative (burn address representative). */
  defaultRepresentative: 'nano_1111111111111111111111111111111111111111111111111111hifc8npp',
  /** Default escrow/agent custody account (burn-address style placeholder). */
  defaultEscrowAccount: 'nano_1111111111111111111111111111111111111111111111111111hifc8npp',
  finalityMs: 1_000,
  zeroPrevious: '0'.repeat(64),
} as const;

export const SUPPORTED_SETTLEMENT_RAILS = ['stellar', 'nano'] as const;
export type SettlementRailId = (typeof SUPPORTED_SETTLEMENT_RAILS)[number];

const NANO_ALPHABET = '13456789abcdefghijkmnopqrstuwxyz';

/** Nano addresses are `nano_`/`xrb_` followed by 60 base32 characters. */
export function isValidNanoAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  const prefix = address.startsWith('nano_') ? 'nano_' : address.startsWith('xrb_') ? 'xrb_' : null;
  if (!prefix) return false;
  const body = address.slice(prefix.length);
  if (body.length !== 60) return false;
  return [...body].every((char) => NANO_ALPHABET.includes(char));
}

/** Convert a decimal XNO amount to raw (10^-30 XNO) units. */
export function xnoToRaw(amountXno: number): bigint {
  if (!Number.isFinite(amountXno) || amountXno < 0) {
    throw new Error(`Invalid XNO amount: ${amountXno}`);
  }
  const fixed = amountXno.toFixed(NANO_CONFIG.decimals);
  const [whole, fraction = ''] = fixed.split('.');
  const fractionPadded = fraction.padEnd(NANO_CONFIG.decimals, '0').slice(0, NANO_CONFIG.decimals);
  return BigInt(whole) * NANO_CONFIG.rawPerXno + BigInt(fractionPadded);
}

/** Convert raw units back to a decimal XNO number. */
export function rawToXno(raw: bigint | string): number {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw);
  const whole = value / NANO_CONFIG.rawPerXno;
  const fraction = value % NANO_CONFIG.rawPerXno;
  return Number(whole) + Number(fraction) / 1e30;
}

function sha256(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Nano's settle rail: hold and release as two feeless blocks.
 */
export class NanoSettleRail {
  readonly id: SettlementRailId = 'nano';

  private readonly representative: string;
  private readonly escrowAccount: string;
  private readonly finalityMs: number;
  private readonly now: () => number;

  private readonly escrows = new Map<string, NanoEscrow>();
  private readonly idempotency = new Map<string, string>();
  private readonly idempotencyFingerprints = new Map<string, string>();
  private readonly accountBalances = new Map<string, bigint>();
  private sequence = 0;

  constructor(config: NanoRailConfig = {}) {
    this.representative = config.representative ?? NANO_CONFIG.defaultRepresentative;
    this.escrowAccount = config.escrowAccount ?? NANO_CONFIG.defaultEscrowAccount;
    this.finalityMs = config.finalityMs ?? NANO_CONFIG.finalityMs;
    this.now = config.now ?? (() => Date.now());
  }

  /** Fund an account with simulated balance (test/faucet helper). */
  fundAccount(address: string, amountXno: number): void {
    if (!isValidNanoAddress(address)) throw new Error(`Invalid Nano address: ${address}`);
    const current = this.accountBalances.get(address) ?? 0n;
    this.accountBalances.set(address, current + xnoToRaw(amountXno));
  }

  getBalanceRaw(address: string): bigint {
    return this.accountBalances.get(address) ?? 0n;
  }

  getBalanceXno(address: string): number {
    return rawToXno(this.getBalanceRaw(address));
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }

  private createBlock(params: {
    type: NanoBlockType;
    account: string;
    previous: string;
    representative: string;
    balance: bigint;
    link: string;
    amountRaw: bigint;
  }): NanoBlock {
    this.sequence += 1;
    const timestamp = this.timestamp();
    const canonical = [
      params.type,
      params.account,
      params.previous,
      params.representative,
      params.balance.toString(),
      params.link,
      params.amountRaw.toString(),
      String(this.sequence),
      timestamp,
    ].join('|');
    const hash = sha256(canonical);
    const signature = createHmac('sha256', 'nano-settle-rail-simulated').update(hash).digest('hex');

    return {
      hash,
      type: params.type,
      account: params.account,
      previous: params.previous,
      representative: params.representative,
      balance: params.balance.toString(),
      link: params.link,
      signature,
      amountRaw: params.amountRaw.toString(),
      amountXno: rawToXno(params.amountRaw),
      timestamp,
      feeless: true,
      finalityMs: this.finalityMs,
      confirmed: true,
    };
  }

  /**
   * Hold funds: one feeless send from the payer to the escrow/agent account.
   */
  holdEscrow(input: HoldEscrowInput): NanoEscrow {
    if (!isValidNanoAddress(input.payer)) throw new Error(`Invalid payer address: ${input.payer}`);
    if (!isValidNanoAddress(input.payee)) throw new Error(`Invalid payee address: ${input.payee}`);
    if (!Number.isFinite(input.amountXno) || input.amountXno <= 0) {
      throw new Error('Escrow amount must be greater than zero');
    }

    if (input.idempotencyKey) {
      const existingId = this.idempotency.get(input.idempotencyKey);
      if (existingId) {
        const fingerprint = this.fingerprint(input);
        const previous = this.idempotencyFingerprints.get(input.idempotencyKey);
        if (previous && previous !== fingerprint) {
          throw new Error('IDEMPOTENCY_KEY_REUSE_MISMATCH');
        }
        const existing = this.escrows.get(existingId);
        if (existing) return existing;
      }
    }

    const amountRaw = xnoToRaw(input.amountXno);
    const payerBalance = this.getBalanceRaw(input.payer);
    if (payerBalance < amountRaw) {
      throw new Error('Insufficient payer balance for escrow hold');
    }

    const representative = input.representative ?? this.representative;
    const payerRemaining = payerBalance - amountRaw;
    const escrowBalance = this.getBalanceRaw(this.escrowAccount) + amountRaw;

    const holdBlock = this.createBlock({
      type: 'send',
      account: input.payer,
      previous: NANO_CONFIG.zeroPrevious,
      representative,
      balance: payerRemaining,
      link: this.escrowAccount,
      amountRaw,
    });

    this.accountBalances.set(input.payer, payerRemaining);
    this.accountBalances.set(this.escrowAccount, escrowBalance);

    const id = input.escrowId ?? `escrow_${randomUUID()}`;
    const createdAt = this.timestamp();
    const escrow: NanoEscrow = {
      id,
      payer: input.payer,
      payee: input.payee,
      escrowAccount: this.escrowAccount,
      representative,
      amountXno: rawToXno(amountRaw),
      amountRaw: amountRaw.toString(),
      status: 'held',
      holdBlock,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
      createdAt,
      updatedAt: createdAt,
    };

    this.escrows.set(id, escrow);
    if (input.idempotencyKey) {
      this.idempotency.set(input.idempotencyKey, id);
      this.idempotencyFingerprints.set(input.idempotencyKey, this.fingerprint(input));
    }
    return escrow;
  }

  /**
   * Release funds: one feeless send from the escrow account to the payee. The
   * release block is the confirmation, so the call is idempotent per escrow.
   */
  releaseEscrow(escrowId: string, options: { approvedBy?: string } = {}): NanoEscrow {
    const escrow = this.requireEscrow(escrowId);
    if (escrow.status === 'released') return escrow;
    if (escrow.status !== 'held') {
      throw new Error(`Escrow ${escrowId} cannot be released from status ${escrow.status}`);
    }

    const amountRaw = BigInt(escrow.amountRaw);
    const escrowBalance = this.getBalanceRaw(this.escrowAccount);
    if (escrowBalance < amountRaw) {
      throw new Error('Escrow account is under-collateralised');
    }

    const payeeBalance = this.getBalanceRaw(escrow.payee) + amountRaw;
    const releaseBlock = this.createBlock({
      type: 'send',
      account: this.escrowAccount,
      previous: escrow.holdBlock.hash,
      representative: escrow.representative,
      balance: escrowBalance - amountRaw,
      link: escrow.payee,
      amountRaw,
    });

    this.accountBalances.set(this.escrowAccount, escrowBalance - amountRaw);
    this.accountBalances.set(escrow.payee, payeeBalance);

    escrow.status = 'released';
    escrow.releaseBlock = releaseBlock;
    escrow.releasedAt = this.timestamp();
    escrow.updatedAt = escrow.releasedAt;
    escrow.approvedBy = options.approvedBy;
    this.escrows.set(escrowId, escrow);
    return escrow;
  }

  /**
   * Refund funds: one feeless send from the escrow account back to the payer.
   */
  refundEscrow(escrowId: string, options: { reason?: string } = {}): NanoEscrow {
    const escrow = this.requireEscrow(escrowId);
    if (escrow.status === 'refunded') return escrow;
    if (escrow.status !== 'held') {
      throw new Error(`Escrow ${escrowId} cannot be refunded from status ${escrow.status}`);
    }

    const amountRaw = BigInt(escrow.amountRaw);
    const escrowBalance = this.getBalanceRaw(this.escrowAccount);
    const payerBalance = this.getBalanceRaw(escrow.payer) + amountRaw;

    const refundBlock = this.createBlock({
      type: 'send',
      account: this.escrowAccount,
      previous: escrow.holdBlock.hash,
      representative: escrow.representative,
      balance: escrowBalance - amountRaw,
      link: escrow.payer,
      amountRaw,
    });

    this.accountBalances.set(this.escrowAccount, escrowBalance - amountRaw);
    this.accountBalances.set(escrow.payer, payerBalance);

    escrow.status = 'refunded';
    escrow.refundBlock = refundBlock;
    escrow.refundedAt = this.timestamp();
    escrow.updatedAt = escrow.refundedAt;
    if (options.reason) escrow.metadata = { ...(escrow.metadata ?? {}), refundReason: options.reason };
    this.escrows.set(escrowId, escrow);
    return escrow;
  }

  getEscrow(escrowId: string): NanoEscrow | null {
    return this.escrows.get(escrowId) ?? null;
  }

  listEscrows(filter?: { status?: NanoEscrowStatus; payer?: string; payee?: string }): NanoEscrow[] {
    let list = Array.from(this.escrows.values());
    if (filter?.status) list = list.filter((e) => e.status === filter.status);
    if (filter?.payer) list = list.filter((e) => e.payer === filter.payer);
    if (filter?.payee) list = list.filter((e) => e.payee === filter.payee);
    return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Look up a block by hash across every escrow. */
  getBlock(hash: string): NanoBlock | null {
    for (const escrow of this.escrows.values()) {
      if (escrow.holdBlock.hash === hash) return escrow.holdBlock;
      if (escrow.releaseBlock?.hash === hash) return escrow.releaseBlock;
      if (escrow.refundBlock?.hash === hash) return escrow.refundBlock;
    }
    return null;
  }

  /**
   * Verify a release block as a public receipt, without trusting either party.
   */
  verifyEscrowReceipt(escrowId: string): NanoReceiveVerification {
    const escrow = this.requireEscrow(escrowId);
    const block = escrow.releaseBlock;
    return {
      escrowId,
      status: escrow.status,
      blockHash: block?.hash,
      to: block?.link,
      amountXno: block?.amountXno,
      feeless: true,
      finalityMs: this.finalityMs,
      verified: escrow.status === 'released' && Boolean(block?.confirmed),
      explorerHint: block ? `nano://block/${block.hash}` : 'nano://pending',
    };
  }

  getMetrics(): NanoRailMetrics {
    const escrows = Array.from(this.escrows.values());
    return {
      escrows: escrows.length,
      held: escrows.filter((e) => e.status === 'held').length,
      released: escrows.filter((e) => e.status === 'released').length,
      refunded: escrows.filter((e) => e.status === 'refunded').length,
      feesCollectedRaw: '0',
      feesCollectedXno: 0,
    };
  }

  private requireEscrow(escrowId: string): NanoEscrow {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new Error(`Escrow not found: ${escrowId}`);
    return escrow;
  }

  private fingerprint(input: HoldEscrowInput): string {
    return [
      input.payer,
      input.payee,
      xnoToRaw(input.amountXno).toString(),
      input.representative ?? this.representative,
    ].join('|');
  }
}

/**
 * Factory used by the API layer so the escrow rail can be swapped per environment.
 */
export function createNanoSettleRail(config: NanoRailConfig = {}): NanoSettleRail {
  return new NanoSettleRail(config);
}

/** Pick a settlement rail for an asset; Nano (XNO) routes to this rail. */
export function resolveSettlementRail(asset: string): SettlementRailId {
  return asset.toUpperCase() === NANO_CONFIG.ticker ? 'nano' : 'stellar';
}
