import { describe, expect, it, vi, type Mock } from 'vitest';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { Wallet, id as utf8Keccak, zeroPadValue } from 'ethers';

vi.mock('../../observability/datadog.js', () => ({
  default: { increment: vi.fn(), distribution: vi.fn() },
}));

import {
  SettlementProofError,
  SettlementProofRelayer,
  buildSettlementProof,
  chainIdentifier,
  evmProofSubmitter,
  recoverProofSigner,
  settlementProofDigest,
  walletAttester,
  type ProofAttester,
  type ProofDomain,
  type ProofSubmitter,
  type SettlementObservation,
  type SettlementProofRelayerOptions,
} from '../settlementProof.js';

const NOW = 1_700_000_000_000;
const DOMAIN: ProofDomain = { chainId: 1, verifyingContract: '0x00000000000000000000000000000000000000AA' };
const WALLETS = [
  new Wallet('0x' + '11'.repeat(32)),
  new Wallet('0x' + '22'.repeat(32)),
  new Wallet('0x' + '33'.repeat(32)),
];
const STELLAR_TX = 'a'.repeat(64);
const EVM_RECIPIENT = '0x000000000000000000000000000000000000bEEF';
const EVM_TOKEN = '0x000000000000000000000000000000000000cafE';
const STELLAR_RECIPIENT = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();
const SOROBAN_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 9));

function inbound(overrides: Partial<SettlementObservation> = {}): SettlementObservation {
  return {
    settlementId: 'settle-1',
    lane: 'stellar->evm',
    sourceNetwork: 'stellar:pubnet',
    sourceHeight: 51_234_567,
    sourceTxHash: STELLAR_TX,
    recipient: EVM_RECIPIENT,
    token: EVM_TOKEN,
    amount: '1250000000',
    confirmations: 1,
    ...overrides,
  };
}

function outbound(overrides: Partial<SettlementObservation> = {}): SettlementObservation {
  return {
    settlementId: 'out-1',
    lane: 'evm->stellar',
    sourceNetwork: 'evm:1',
    sourceHeight: 19_000_000,
    sourceTxHash: '0x' + 'b'.repeat(64),
    recipient: STELLAR_RECIPIENT,
    token: SOROBAN_TOKEN,
    amount: 42n,
    confirmations: 12,
    ...overrides,
  };
}

function fakeSubmitter(overrides: { isRelayed?: Mock; submit?: Mock } = {}): ProofSubmitter & { isRelayed: Mock; submit: Mock } {
  return {
    isRelayed: overrides.isRelayed ?? vi.fn(async () => false),
    submit: overrides.submit ?? vi.fn(async () => ({ txHash: '0xdest' })),
  };
}

function setup(options: Partial<SettlementProofRelayerOptions> & { submitter?: ReturnType<typeof fakeSubmitter> } = {}) {
  let clock = NOW;
  const submitter = options.submitter ?? fakeSubmitter();
  const metrics = { increment: vi.fn(), distribution: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const relayer = new SettlementProofRelayer({
    lanes: {
      'stellar->evm': { domain: DOMAIN, submitter, minConfirmations: 1 },
      'evm->stellar': { domain: DOMAIN, submitter, minConfirmations: 12 },
    },
    attesters: WALLETS.map((w) => walletAttester(w)),
    threshold: 2,
    baseBackoffMs: 1_000,
    maxAttempts: 3,
    attestationTimeoutMs: 50,
    now: () => clock,
    metrics,
    logger,
    ...options,
  });
  return { relayer, submitter, metrics, logger, advance: (ms: number) => (clock += ms) };
}

describe('settlement proof encoding (#1516)', () => {
  it('matches the digest vector pinned in SettlementProofRelay.t.sol', () => {
    const proof = buildSettlementProof(
      inbound({
        settlementId: utf8Keccak('vector-settlement'),
        sourceTxHash: utf8Keccak('vector-tx'),
      }),
    );
    expect(settlementProofDigest(proof, DOMAIN)).toBe(
      '0x19feb92540fc7f3429112b3b23835c7ddddf6decadd389965daac67b949e8c98',
    );
  });

  it('encodes EVM accounts left-padded and Stellar accounts as raw 32-byte keys', () => {
    const toEvm = buildSettlementProof(inbound());
    expect(toEvm.recipient).toBe(zeroPadValue(EVM_RECIPIENT, 32).toLowerCase());
    expect(toEvm.sourceChain).toBe(utf8Keccak('stellar:pubnet'));
    expect(toEvm.sourceTxHash).toBe('0x' + STELLAR_TX);

    const toStellar = buildSettlementProof(outbound());
    expect(toStellar.recipient).toBe('0x' + Buffer.from(StrKey.decodeEd25519PublicKey(STELLAR_RECIPIENT)).toString('hex'));
    expect(toStellar.token).toBe('0x' + '09'.repeat(32));
    expect(toStellar.amount).toBe(42n);
  });

  it('hashes free-form settlement ids and keeps bytes32 ids verbatim', () => {
    expect(buildSettlementProof(inbound()).settlementId).toBe(utf8Keccak('settle-1'));
    const raw = '0x' + 'C'.repeat(64);
    expect(buildSettlementProof(inbound({ settlementId: raw })).settlementId).toBe(raw.toLowerCase());
  });

  it.each([
    ['source network on the wrong side of the lane', inbound({ sourceNetwork: 'evm:1' }), 'LANE_MISMATCH'],
    ['unknown network', inbound({ sourceNetwork: 'stellar:mainnet' }), 'INVALID_NETWORK'],
    ['Stellar recipient on the evm lane', inbound({ recipient: STELLAR_RECIPIENT }), 'INVALID_ACCOUNT'],
    ['EVM recipient on the stellar lane', outbound({ recipient: EVM_RECIPIENT }), 'INVALID_ACCOUNT'],
    ['contract as a Stellar recipient', outbound({ recipient: SOROBAN_TOKEN }), 'INVALID_ACCOUNT'],
    ['zero amount', inbound({ amount: '0' }), 'INVALID_AMOUNT'],
    ['fractional amount', inbound({ amount: '1.5' }), 'INVALID_AMOUNT'],
    ['short tx hash', inbound({ sourceTxHash: 'abc' }), 'INVALID_TX_HASH'],
    ['negative height', inbound({ sourceHeight: -1 }), 'INVALID_HEIGHT'],
    ['empty id', inbound({ settlementId: '' }), 'INVALID_SETTLEMENT_ID'],
  ])('rejects %s', (_label, observation, code) => {
    expect(() => buildSettlementProof(observation)).toThrow(expect.objectContaining({ code }));
  });

  it('recovers the attester from a wallet signature', async () => {
    const proof = buildSettlementProof(inbound());
    const signature = await walletAttester(WALLETS[0]).signProof(proof, DOMAIN);
    expect(recoverProofSigner(proof, DOMAIN, signature)).toBe(WALLETS[0].address);
    expect(recoverProofSigner(proof, { ...DOMAIN, chainId: 8453 }, signature)).not.toBe(WALLETS[0].address);
  });

  it('derives chain identifiers from network names', () => {
    expect(chainIdentifier('evm:8453')).toBe(utf8Keccak('evm:8453'));
    expect(() => chainIdentifier('solana:mainnet')).toThrow(SettlementProofError);
  });
});

describe('SettlementProofRelayer (#1516)', () => {
  it('rejects an invalid attester configuration', () => {
    expect(() => setup({ threshold: 4 })).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    expect(() => setup({ threshold: 0 })).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    expect(() => setup({ attesters: [walletAttester(WALLETS[0]), walletAttester(WALLETS[0])], threshold: 1 })).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' }),
    );
  });

  it('relays an inbound proof with signatures sorted by signer address', async () => {
    const { relayer, submitter, metrics } = setup();
    relayer.observe(inbound());
    const record = await relayer.process('settle-1');

    expect(record.status).toBe('relayed');
    expect(record.destinationTxHash).toBe('0xdest');
    expect(submitter.submit).toHaveBeenCalledTimes(1);

    const [proof, signatures] = submitter.submit.mock.calls[0] as unknown as [ReturnType<typeof buildSettlementProof>, string[]];
    expect(signatures).toHaveLength(3);
    const signers = signatures.map((s) => recoverProofSigner(proof, DOMAIN, s).toLowerCase());
    expect(signers).toEqual([...signers].sort());
    expect(metrics.increment).toHaveBeenCalledWith('settlement_proof.relayed', 1, { lane: 'stellar->evm' });
    expect(metrics.distribution).toHaveBeenCalledWith('settlement_proof.relay_latency_ms', 0, { lane: 'stellar->evm' });
  });

  it('holds an outbound settlement until the EVM confirmation floor is met', async () => {
    const { relayer, submitter } = setup();
    expect(relayer.observe(outbound({ confirmations: 3 })).status).toBe('awaiting_finality');
    expect((await relayer.process('out-1')).status).toBe('awaiting_finality');
    expect(submitter.submit).not.toHaveBeenCalled();

    expect(relayer.observe(outbound({ confirmations: 12 })).status).toBe('pending');
    expect((await relayer.process('out-1')).status).toBe('relayed');
  });

  it('never lowers recorded confirmations on a stale re-observation', () => {
    const { relayer } = setup();
    relayer.observe(outbound({ confirmations: 12 }));
    expect(relayer.observe(outbound({ confirmations: 2 })).confirmations).toBe(12);
  });

  it('rejects a conflicting re-observation of the same settlement', () => {
    const { relayer, metrics } = setup();
    relayer.observe(inbound());
    expect(() => relayer.observe(inbound({ amount: '1' }))).toThrow(
      expect.objectContaining({ code: 'CONFLICTING_OBSERVATION' }),
    );
    expect(metrics.increment).toHaveBeenCalledWith('settlement_proof.conflict', 1, { lane: 'stellar->evm' });
  });

  it('refuses observations on an unconfigured lane', () => {
    const { relayer } = setup({ lanes: {} });
    expect(() => relayer.observe(inbound())).toThrow(expect.objectContaining({ code: 'LANE_DISABLED' }));
  });

  it('reports unknown settlements', async () => {
    const { relayer } = setup();
    await expect(relayer.process('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(relayer.get('missing')).toBeUndefined();
  });

  it('tolerates attesters that fail or time out while the threshold still holds', async () => {
    const failing: ProofAttester = { address: WALLETS[1].address, signProof: async () => Promise.reject(new Error('hsm offline')) };
    const hanging: ProofAttester = { address: WALLETS[2].address, signProof: () => new Promise(() => undefined) };
    const { relayer, submitter, logger } = setup({
      attesters: [walletAttester(WALLETS[0]), failing, hanging, walletAttester(new Wallet('0x' + '44'.repeat(32)))],
    });
    relayer.observe(inbound());
    expect((await relayer.process('settle-1')).status).toBe('relayed');
    expect((submitter.submit.mock.calls[0] as unknown[])[1]).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith('[settlement-proof] attester unavailable', expect.objectContaining({ error: 'hsm offline' }));
  });

  it('drops signatures that do not recover to the claimed attester', async () => {
    const impostor: ProofAttester = {
      address: WALLETS[1].address,
      signProof: (proof, domain) => walletAttester(WALLETS[2]).signProof(proof, domain),
    };
    const garbage: ProofAttester = { address: WALLETS[2].address, signProof: async () => '0xdeadbeef' };
    const { relayer, submitter, metrics } = setup({ attesters: [walletAttester(WALLETS[0]), impostor, garbage] });
    relayer.observe(inbound());

    const record = await relayer.process('settle-1');
    expect(record.status).toBe('pending');
    expect(record.attempts).toBe(1);
    expect(record.lastError).toBe('collected 1/2 valid attestations');
    expect(submitter.submit).not.toHaveBeenCalled();
    expect(metrics.increment).toHaveBeenCalledWith('settlement_proof.invalid_attestation', 1, { lane: 'stellar->evm' });
    expect(metrics.increment).toHaveBeenCalledWith('settlement_proof.attestation_shortfall', 1, { lane: 'stellar->evm' });
  });

  it('backs off exponentially, reuses collected signatures, then succeeds', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error('nonce too low'))
      .mockRejectedValueOnce(new Error('rpc 503'))
      .mockResolvedValueOnce({ txHash: '0xfinal' });
    const { relayer, advance } = setup({ submitter: fakeSubmitter({ submit }) });
    const signSpy = vi.spyOn(WALLETS[0], 'signTypedData');
    relayer.observe(inbound());

    let record = await relayer.process('settle-1');
    expect(record).toMatchObject({ status: 'attested', attempts: 1, nextAttemptAt: NOW + 1_000 });
    expect(await relayer.processDue()).toEqual([]);

    advance(1_000);
    [record] = await relayer.processDue();
    expect(record).toMatchObject({ status: 'attested', attempts: 2, nextAttemptAt: NOW + 1_000 + 2_000 });

    advance(2_000);
    [record] = await relayer.processDue();
    expect(record).toMatchObject({ status: 'relayed', destinationTxHash: '0xfinal' });
    expect(signSpy).toHaveBeenCalledTimes(1);
    signSpy.mockRestore();
  });

  it('marks the settlement failed after maxAttempts', async () => {
    const { relayer, metrics, logger } = setup({
      submitter: fakeSubmitter({ submit: vi.fn().mockRejectedValue(new Error('execution reverted')) }),
      maxAttempts: 2,
    });
    relayer.observe(inbound());
    await relayer.process('settle-1');
    const record = await relayer.process('settle-1');

    expect(record).toMatchObject({ status: 'failed', attempts: 2, lastError: 'submission failed: execution reverted' });
    expect(metrics.increment).toHaveBeenCalledWith('settlement_proof.failed', 1, { lane: 'stellar->evm' });
    expect(logger.error).toHaveBeenCalled();
    expect((await relayer.process('settle-1')).status).toBe('failed');
    expect(relayer.list('failed')).toHaveLength(1);
  });

  it('treats a proof landed by another relayer as relayed', async () => {
    const { relayer, submitter, metrics } = setup({ submitter: fakeSubmitter({ isRelayed: vi.fn(async () => true) }) });
    relayer.observe(inbound());
    expect((await relayer.process('settle-1')).status).toBe('relayed');
    expect(submitter.submit).not.toHaveBeenCalled();
    expect(metrics.increment).toHaveBeenCalledWith('settlement_proof.already_relayed', 1, { lane: 'stellar->evm' });
  });

  it('treats an AlreadyRelayed revert during submission as relayed', async () => {
    const { relayer } = setup({
      submitter: fakeSubmitter({ submit: vi.fn().mockRejectedValue(new Error('execution reverted: AlreadyRelayed(0x..)')) }),
    });
    relayer.observe(inbound());
    expect((await relayer.process('settle-1')).status).toBe('relayed');
  });

  it('still submits when the isRelayed pre-check errors', async () => {
    const { relayer, submitter } = setup({
      submitter: fakeSubmitter({ isRelayed: vi.fn().mockRejectedValue(new Error('rpc down')) }),
    });
    relayer.observe(inbound());
    expect((await relayer.process('settle-1')).status).toBe('relayed');
    expect(submitter.submit).toHaveBeenCalledTimes(1);
  });

  it('does not submit the same settlement twice when processed concurrently', async () => {
    const { relayer, submitter } = setup();
    relayer.observe(inbound());
    await Promise.all([relayer.process('settle-1'), relayer.process('settle-1')]);
    expect(submitter.submit).toHaveBeenCalledTimes(1);
  });

  it('returns snapshots that callers cannot mutate', () => {
    const { relayer } = setup();
    const record = relayer.observe(inbound());
    record.status = 'relayed';
    expect(relayer.get('settle-1')?.status).toBe('pending');
  });
});

describe('evmProofSubmitter (#1516)', () => {
  it('waits for the transaction and returns its hash', async () => {
    const wait = vi.fn(async () => ({}));
    const contract = { isRelayed: vi.fn(async () => true), relayProof: vi.fn(async () => ({ hash: '0xabc', wait })) };
    const submitter = evmProofSubmitter(contract);
    const proof = buildSettlementProof(inbound());

    await expect(submitter.submit(proof, ['0x01'])).resolves.toEqual({ txHash: '0xabc' });
    expect(contract.relayProof).toHaveBeenCalledWith(proof, ['0x01']);
    expect(wait).toHaveBeenCalled();
    await expect(submitter.isRelayed(proof.settlementId)).resolves.toBe(true);
  });
});
