/**
 * Cross-chain settlement proof relayer for the Stellar <-> EVM lanes — Issue #1516
 *
 * A settlement that finalises on one chain is proven to the other by an
 * M-of-N attester set. The relayer:
 *
 *   observe   — records a source-chain settlement (Stellar ledger close or an
 *               EVM `SettlementCommitted` event), idempotent per settlement id
 *   finality  — holds the settlement until the lane's confirmation floor is met
 *   attest    — collects EIP-712 signatures, drops any that do not recover to
 *               the attester that produced them, requires `threshold` valid ones
 *   submit    — delivers the proof with signatures sorted by signer address
 *               (the on-chain duplicate check) to the destination verifier
 *
 * Failures are retried with exponential backoff up to `maxAttempts`; collected
 * signatures are reused across submission retries. A proof that another relayer
 * already landed is treated as relayed, never as an error.
 *
 * The typed-data shape mirrors contracts/bridges/relayer/SettlementProofRelay.sol;
 * both sides are pinned to the same digest test vector.
 */

import { StrKey } from '@stellar/stellar-sdk';
import { TypedDataEncoder, getAddress, id as utf8Keccak, isAddress, isHexString, verifyTypedData, zeroPadValue } from 'ethers';
import defaultMetrics from '../observability/datadog.js';
import { logger as defaultLogger } from '../utils/logger.js';

export type SettlementLane = 'stellar->evm' | 'evm->stellar';
export type SettlementProofStatus = 'awaiting_finality' | 'pending' | 'attested' | 'relayed' | 'failed';

export interface SettlementObservation {
  /** Source-side settlement reference. A 32-byte hex id is used verbatim, anything else is hashed. */
  settlementId: string;
  lane: SettlementLane;
  /** Source network name, e.g. `stellar:pubnet` or `evm:1`. */
  sourceNetwork: string;
  /** Stellar ledger sequence or EVM block number the settlement landed in. */
  sourceHeight: number;
  sourceTxHash: string;
  /** EVM address for the stellar->evm lane, Stellar account (G...) for evm->stellar. */
  recipient: string;
  /** EVM token address, or Soroban asset contract (C...). */
  token: string;
  /** Amount in the token's smallest unit. */
  amount: string | bigint;
  confirmations: number;
}

/** Mirror of `SettlementProofRelay.SettlementProof`. */
export interface SettlementProof {
  settlementId: string;
  sourceChain: string;
  sourceHeight: bigint;
  sourceTxHash: string;
  recipient: string;
  token: string;
  amount: bigint;
}

export interface ProofDomain {
  chainId: number | bigint;
  verifyingContract: string;
}

export interface ProofAttester {
  address: string;
  signProof(proof: SettlementProof, domain: ProofDomain): Promise<string>;
}

export interface ProofSubmitter {
  isRelayed(settlementId: string): Promise<boolean>;
  submit(proof: SettlementProof, signatures: string[]): Promise<{ txHash: string }>;
}

export interface LaneConfig {
  domain: ProofDomain;
  submitter: ProofSubmitter;
  /** Source confirmations required before attesting. Stellar ledgers are final on close, so 1 is enough there. */
  minConfirmations: number;
}

export interface SettlementProofRecord {
  settlementId: string;
  lane: SettlementLane;
  proof: SettlementProof;
  status: SettlementProofStatus;
  confirmations: number;
  signatures: string[];
  attempts: number;
  nextAttemptAt: number;
  observedAt: number;
  updatedAt: number;
  relayedAt?: number;
  destinationTxHash?: string;
  lastError?: string;
}

export interface MetricsSink {
  increment(metric: string, value?: number, tags?: Record<string, string>): void;
  distribution(metric: string, value: number, tags?: Record<string, string>): void;
}

export interface LoggerSink {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface SettlementProofRelayerOptions {
  lanes: Partial<Record<SettlementLane, LaneConfig>>;
  attesters: ProofAttester[];
  threshold: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  attestationTimeoutMs?: number;
  now?: () => number;
  metrics?: MetricsSink;
  logger?: LoggerSink;
}

export class SettlementProofError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'SettlementProofError';
  }
}

export const SETTLEMENT_PROOF_DOMAIN_NAME = 'AgenticPaySettlementProofRelay';
export const SETTLEMENT_PROOF_DOMAIN_VERSION = '1';
export const SETTLEMENT_PROOF_TYPES = {
  SettlementProof: [
    { name: 'settlementId', type: 'bytes32' },
    { name: 'sourceChain', type: 'bytes32' },
    { name: 'sourceHeight', type: 'uint64' },
    { name: 'sourceTxHash', type: 'bytes32' },
    { name: 'recipient', type: 'bytes32' },
    { name: 'token', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
  ],
};

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const NETWORK_PATTERN = /^(stellar:(pubnet|testnet|futurenet)|evm:\d+)$/;
const ALREADY_RELAYED_PATTERN = /AlreadyRelayed|already relayed/i;
const METRIC_PREFIX = 'settlement_proof';

/** On-chain identifier for a network name: keccak256 of its UTF-8 bytes (`stellar:pubnet` → bytes32). */
export function chainIdentifier(network: string): string {
  if (!NETWORK_PATTERN.test(network)) {
    throw new SettlementProofError(`Unsupported source network "${network}"`, 'INVALID_NETWORK');
  }
  return utf8Keccak(network);
}

function sourceFamily(lane: SettlementLane): 'stellar' | 'evm' {
  return lane === 'stellar->evm' ? 'stellar' : 'evm';
}

function encodeEvmAddress(value: string, field: string): string {
  if (!isAddress(value)) {
    throw new SettlementProofError(`${field} must be an EVM address on the stellar->evm lane`, 'INVALID_ACCOUNT');
  }
  return zeroPadValue(getAddress(value), 32).toLowerCase();
}

function encodeStellarAccount(value: string, field: string, allowContract: boolean): string {
  if (StrKey.isValidEd25519PublicKey(value)) {
    return `0x${Buffer.from(StrKey.decodeEd25519PublicKey(value)).toString('hex')}`;
  }
  if (allowContract && StrKey.isValidContract(value)) {
    return `0x${Buffer.from(StrKey.decodeContract(value)).toString('hex')}`;
  }
  throw new SettlementProofError(`${field} must be a Stellar ${allowContract ? 'account or contract' : 'account'} on the evm->stellar lane`, 'INVALID_ACCOUNT');
}

function normaliseTxHash(value: string): string {
  const hex = value.startsWith('0x') ? value : `0x${value}`;
  if (!isHexString(hex, 32)) {
    throw new SettlementProofError('sourceTxHash must be a 32-byte hex hash', 'INVALID_TX_HASH');
  }
  return hex.toLowerCase();
}

function normaliseSettlementId(value: string): string {
  if (!value) throw new SettlementProofError('settlementId is required', 'INVALID_SETTLEMENT_ID');
  return isHexString(value, 32) ? value.toLowerCase() : utf8Keccak(value);
}

/** Canonical proof for an observation; validates every field against the lane's account format. */
export function buildSettlementProof(observation: SettlementObservation): SettlementProof {
  const family = sourceFamily(observation.lane);
  if (!observation.sourceNetwork.startsWith(`${family}:`)) {
    throw new SettlementProofError(
      `Lane ${observation.lane} must originate on a ${family} network, got ${observation.sourceNetwork}`,
      'LANE_MISMATCH',
    );
  }

  const height = BigInt(observation.sourceHeight);
  if (height < 0n || height > MAX_UINT64) {
    throw new SettlementProofError('sourceHeight must fit in uint64', 'INVALID_HEIGHT');
  }

  let amount: bigint;
  try {
    amount = BigInt(observation.amount);
  } catch {
    throw new SettlementProofError('amount must be an integer in base units', 'INVALID_AMOUNT');
  }
  if (amount <= 0n || amount > MAX_UINT256) {
    throw new SettlementProofError('amount must be a positive uint256', 'INVALID_AMOUNT');
  }

  const toEvm = observation.lane === 'stellar->evm';
  return {
    settlementId: normaliseSettlementId(observation.settlementId),
    sourceChain: chainIdentifier(observation.sourceNetwork),
    sourceHeight: height,
    sourceTxHash: normaliseTxHash(observation.sourceTxHash),
    recipient: toEvm
      ? encodeEvmAddress(observation.recipient, 'recipient')
      : encodeStellarAccount(observation.recipient, 'recipient', false),
    token: toEvm ? encodeEvmAddress(observation.token, 'token') : encodeStellarAccount(observation.token, 'token', true),
    amount,
  };
}

function typedDomain(domain: ProofDomain) {
  return {
    name: SETTLEMENT_PROOF_DOMAIN_NAME,
    version: SETTLEMENT_PROOF_DOMAIN_VERSION,
    chainId: domain.chainId,
    verifyingContract: domain.verifyingContract,
  };
}

/** EIP-712 digest the destination verifier checks signatures against. */
export function settlementProofDigest(proof: SettlementProof, domain: ProofDomain): string {
  return TypedDataEncoder.hash(typedDomain(domain), SETTLEMENT_PROOF_TYPES, proof);
}

export function recoverProofSigner(proof: SettlementProof, domain: ProofDomain, signature: string): string {
  return verifyTypedData(typedDomain(domain), SETTLEMENT_PROOF_TYPES, proof, signature);
}

/** Attester backed by an ethers signer (Wallet, KMS signer, ...). */
export function walletAttester(signer: {
  address: string;
  signTypedData(domain: object, types: typeof SETTLEMENT_PROOF_TYPES, value: SettlementProof): Promise<string>;
}): ProofAttester {
  return {
    address: signer.address,
    signProof: (proof, domain) => signer.signTypedData(typedDomain(domain), SETTLEMENT_PROOF_TYPES, proof),
  };
}

/** Submitter for an EVM `SettlementProofRelay` deployment (an ethers Contract instance). */
export function evmProofSubmitter(contract: {
  isRelayed(settlementId: string): Promise<boolean>;
  relayProof(proof: SettlementProof, signatures: string[]): Promise<{ hash: string; wait(): Promise<unknown> }>;
}): ProofSubmitter {
  return {
    isRelayed: (settlementId) => contract.isRelayed(settlementId),
    async submit(proof, signatures) {
      const tx = await contract.relayProof(proof, signatures);
      await tx.wait();
      return { txHash: tx.hash };
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameProof(a: SettlementProof, b: SettlementProof): boolean {
  return (
    a.sourceChain === b.sourceChain &&
    a.sourceHeight === b.sourceHeight &&
    a.sourceTxHash === b.sourceTxHash &&
    a.recipient === b.recipient &&
    a.token === b.token &&
    a.amount === b.amount
  );
}

export class SettlementProofRelayer {
  private readonly records = new Map<string, SettlementProofRecord>();
  private readonly inFlight = new Set<string>();
  private readonly lanes: Partial<Record<SettlementLane, LaneConfig>>;
  private readonly attesters: ProofAttester[];
  private readonly threshold: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly attestationTimeoutMs: number;
  private readonly now: () => number;
  private readonly metrics: MetricsSink;
  private readonly logger: LoggerSink;

  constructor(options: SettlementProofRelayerOptions) {
    const unique = new Set(options.attesters.map((a) => getAddress(a.address)));
    if (unique.size !== options.attesters.length) {
      throw new SettlementProofError('Attester addresses must be unique', 'INVALID_CONFIG');
    }
    if (!Number.isInteger(options.threshold) || options.threshold < 1 || options.threshold > unique.size) {
      throw new SettlementProofError('threshold must be between 1 and the number of attesters', 'INVALID_CONFIG');
    }
    this.lanes = options.lanes;
    this.attesters = options.attesters;
    this.threshold = options.threshold;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseBackoffMs = options.baseBackoffMs ?? 5_000;
    this.attestationTimeoutMs = options.attestationTimeoutMs ?? 10_000;
    this.now = options.now ?? Date.now;
    this.metrics = options.metrics ?? defaultMetrics;
    this.logger = options.logger ?? defaultLogger;
  }

  /** Record a source-chain settlement. Re-observing the same settlement only refreshes its confirmations. */
  observe(observation: SettlementObservation): SettlementProofRecord {
    const lane = this.laneConfig(observation.lane);
    const proof = buildSettlementProof(observation);
    const existing = this.records.get(proof.settlementId);

    if (existing) {
      if (existing.lane !== observation.lane || !sameProof(existing.proof, proof)) {
        this.metrics.increment(`${METRIC_PREFIX}.conflict`, 1, { lane: observation.lane });
        throw new SettlementProofError(
          `Settlement ${proof.settlementId} was already observed with a different payload`,
          'CONFLICTING_OBSERVATION',
        );
      }
      this.setConfirmations(existing, observation.confirmations, lane);
      return { ...existing };
    }

    const now = this.now();
    const record: SettlementProofRecord = {
      settlementId: proof.settlementId,
      lane: observation.lane,
      proof,
      status: 'awaiting_finality',
      confirmations: 0,
      signatures: [],
      attempts: 0,
      nextAttemptAt: now,
      observedAt: now,
      updatedAt: now,
    };
    this.setConfirmations(record, observation.confirmations, lane);
    this.records.set(record.settlementId, record);
    this.metrics.increment(`${METRIC_PREFIX}.observed`, 1, { lane: record.lane });
    this.logger.info('[settlement-proof] observed', { settlementId: record.settlementId, lane: record.lane });
    return { ...record };
  }

  /** Advance a pending settlement as far as it can go: attest, then submit. */
  async process(settlementId: string): Promise<SettlementProofRecord> {
    const record = this.records.get(normaliseSettlementId(settlementId));
    if (!record) throw new SettlementProofError(`Unknown settlement ${settlementId}`, 'NOT_FOUND');
    if (record.status === 'relayed' || record.status === 'failed' || record.status === 'awaiting_finality') {
      return { ...record };
    }
    if (this.inFlight.has(record.settlementId)) return { ...record };

    this.inFlight.add(record.settlementId);
    try {
      await this.advance(record, this.laneConfig(record.lane));
    } finally {
      this.inFlight.delete(record.settlementId);
    }
    return { ...record };
  }

  /** Process every settlement whose backoff window has elapsed. */
  async processDue(): Promise<SettlementProofRecord[]> {
    const now = this.now();
    const due = [...this.records.values()].filter(
      (r) => (r.status === 'pending' || r.status === 'attested') && r.nextAttemptAt <= now,
    );
    return Promise.all(due.map((r) => this.process(r.settlementId)));
  }

  get(settlementId: string): SettlementProofRecord | undefined {
    const record = this.records.get(normaliseSettlementId(settlementId));
    return record ? { ...record } : undefined;
  }

  list(status?: SettlementProofStatus): SettlementProofRecord[] {
    return [...this.records.values()]
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.observedAt - a.observedAt)
      .map((r) => ({ ...r }));
  }

  private laneConfig(lane: SettlementLane): LaneConfig {
    const config = this.lanes[lane];
    if (!config) throw new SettlementProofError(`Lane ${lane} is not configured`, 'LANE_DISABLED');
    return config;
  }

  private setConfirmations(record: SettlementProofRecord, confirmations: number, lane: LaneConfig): void {
    record.confirmations = Math.max(record.confirmations, confirmations);
    if (record.status === 'awaiting_finality' && record.confirmations >= lane.minConfirmations) {
      record.status = 'pending';
    }
    record.updatedAt = this.now();
  }

  private async advance(record: SettlementProofRecord, lane: LaneConfig): Promise<void> {
    const tags = { lane: record.lane };

    try {
      if (await lane.submitter.isRelayed(record.settlementId)) {
        this.markRelayed(record, undefined);
        this.metrics.increment(`${METRIC_PREFIX}.already_relayed`, 1, tags);
        return;
      }
    } catch (error) {
      // The pre-check is an optimisation; a failing read must not block submission.
      this.logger.warn('[settlement-proof] isRelayed check failed', { settlementId: record.settlementId, error: errorMessage(error) });
    }

    if (record.status === 'pending') {
      const signatures = await this.collectSignatures(record, lane.domain);
      if (signatures.length < this.threshold) {
        this.metrics.increment(`${METRIC_PREFIX}.attestation_shortfall`, 1, tags);
        this.recordFailure(record, `collected ${signatures.length}/${this.threshold} valid attestations`);
        return;
      }
      record.signatures = signatures;
      record.status = 'attested';
      record.updatedAt = this.now();
      this.metrics.increment(`${METRIC_PREFIX}.attested`, 1, tags);
    }

    try {
      const { txHash } = await lane.submitter.submit(record.proof, record.signatures);
      this.markRelayed(record, txHash);
    } catch (error) {
      const message = errorMessage(error);
      if (ALREADY_RELAYED_PATTERN.test(message)) {
        this.markRelayed(record, undefined);
        this.metrics.increment(`${METRIC_PREFIX}.already_relayed`, 1, tags);
        return;
      }
      this.metrics.increment(`${METRIC_PREFIX}.submit_error`, 1, tags);
      this.recordFailure(record, `submission failed: ${message}`);
    }
  }

  /** Valid signatures from distinct attesters, sorted by ascending signer address as the verifier requires. */
  private async collectSignatures(record: SettlementProofRecord, domain: ProofDomain): Promise<string[]> {
    const results = await Promise.allSettled(
      this.attesters.map((attester) => withTimeout(attester.signProof(record.proof, domain), this.attestationTimeoutMs)),
    );

    const valid: { signer: string; signature: string }[] = [];
    results.forEach((result, index) => {
      const attester = this.attesters[index];
      if (result.status === 'rejected') {
        this.logger.warn('[settlement-proof] attester unavailable', {
          settlementId: record.settlementId,
          attester: attester.address,
          error: errorMessage(result.reason),
        });
        return;
      }
      let signer: string;
      try {
        signer = recoverProofSigner(record.proof, domain, result.value);
      } catch {
        signer = '';
      }
      if (signer.toLowerCase() !== attester.address.toLowerCase()) {
        this.metrics.increment(`${METRIC_PREFIX}.invalid_attestation`, 1, { lane: record.lane });
        this.logger.warn('[settlement-proof] attestation rejected: signer mismatch', {
          settlementId: record.settlementId,
          attester: attester.address,
        });
        return;
      }
      valid.push({ signer: signer.toLowerCase(), signature: result.value });
    });

    return valid.sort((a, b) => (a.signer < b.signer ? -1 : 1)).map((v) => v.signature);
  }

  private markRelayed(record: SettlementProofRecord, txHash: string | undefined): void {
    const now = this.now();
    record.status = 'relayed';
    record.destinationTxHash = txHash;
    record.relayedAt = now;
    record.updatedAt = now;
    record.lastError = undefined;
    this.metrics.increment(`${METRIC_PREFIX}.relayed`, 1, { lane: record.lane });
    this.metrics.distribution(`${METRIC_PREFIX}.relay_latency_ms`, now - record.observedAt, { lane: record.lane });
    this.logger.info('[settlement-proof] relayed', { settlementId: record.settlementId, lane: record.lane, txHash });
  }

  private recordFailure(record: SettlementProofRecord, reason: string): void {
    const now = this.now();
    record.attempts += 1;
    record.lastError = reason;
    record.updatedAt = now;
    if (record.attempts >= this.maxAttempts) {
      record.status = 'failed';
      this.metrics.increment(`${METRIC_PREFIX}.failed`, 1, { lane: record.lane });
      this.logger.error('[settlement-proof] giving up', { settlementId: record.settlementId, attempts: record.attempts, reason });
      return;
    }
    record.nextAttemptAt = now + this.baseBackoffMs * 2 ** (record.attempts - 1);
    this.logger.warn('[settlement-proof] attempt failed, will retry', {
      settlementId: record.settlementId,
      attempts: record.attempts,
      nextAttemptAt: record.nextAttemptAt,
      reason,
    });
  }
}
