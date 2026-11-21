import { describe, it, expect, vi } from 'vitest';
import { SorobanTransactionBuilder, EVMTransactionBuilder } from '../transaction-builders.js';
import { Keypair } from '@stellar/stellar-sdk';

// ── SorobanTransactionBuilder ─────────────────────────────────────────────────

describe('SorobanTransactionBuilder', () => {
  const kp = Keypair.random();

  it('builds a payment transaction and returns XDR', async () => {
    const built = await new SorobanTransactionBuilder('testnet')
      .source(kp.publicKey())
      .to(Keypair.random().publicKey())
      .value(BigInt(10_000_000)) // 1 XLM in stroops
      .nonce(0)
      .build();

    expect(built.chain).toBe('soroban');
    expect(built.serialised).toBeTruthy();
    expect(built.networkPassphrase).toContain('Test');
  });

  it('build throws without source account', async () => {
    await expect(
      new SorobanTransactionBuilder('testnet').to(Keypair.random().publicKey()).build(),
    ).rejects.toThrow('source account');
  });

  it('simulate returns success when contractId and method are set', async () => {
    const result = await new SorobanTransactionBuilder('testnet')
      .call('CABC...', 'transfer', [])
      .simulate();
    expect(result.success).toBe(true);
  });

  it('simulate returns error when no contractId', async () => {
    const result = await new SorobanTransactionBuilder('testnet').simulate();
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('signs a transaction and returns XDR', async () => {
    const signed = await new SorobanTransactionBuilder('testnet')
      .source(kp.publicKey())
      .to(Keypair.random().publicKey())
      .value(BigInt(10_000_000))
      .nonce(0)
      .sign(kp.secret());
    expect(signed).toBeTruthy();
  });

  it('estimateFee returns base fee', async () => {
    const fee = await new SorobanTransactionBuilder().estimateFee();
    expect(Number(fee)).toBeGreaterThan(0);
  });
});

// ── EVMTransactionBuilder ─────────────────────────────────────────────────────

describe('EVMTransactionBuilder', () => {
  it('builds a transfer transaction', async () => {
    const built = await new EVMTransactionBuilder(1)
      .to('0x1234567890123456789012345678901234567890')
      .value(BigInt('1000000000000000000'))
      .build();

    expect(built.chain).toBe('evm');
    expect(built.chainId).toBe(1);
    const tx = JSON.parse(built.serialised);
    expect(tx.to).toBe('0x1234567890123456789012345678901234567890');
  });

  it('build throws without to address', async () => {
    await expect(new EVMTransactionBuilder(1).value(BigInt(1)).build()).rejects.toThrow('to address');
  });

  it('encodes calldata when abi and method are set', async () => {
    const abi = ['function transfer(address to, uint256 amount)'];
    const built = await new EVMTransactionBuilder(1)
      .to('0x1234567890123456789012345678901234567890')
      .abi(abi)
      .call('transfer', ['0xdeadbeef00000000000000000000000000000000', BigInt('100')])
      .build();

    const tx = JSON.parse(built.serialised);
    expect(tx.data).toMatch(/^0x/);
  });

  it('simulate returns error without provider', async () => {
    const result = await new EVMTransactionBuilder(1)
      .to('0x1234567890123456789012345678901234567890')
      .simulate();
    expect(result.success).toBe(false);
  });

  it('estimateFee returns default when no provider', async () => {
    const fee = await new EVMTransactionBuilder(1)
      .to('0x1234567890123456789012345678901234567890')
      .estimateFee();
    expect(fee).toBe('21000');
  });

  it('fluent interface returns same instance', () => {
    const b = new EVMTransactionBuilder(1);
    expect(b.to('0x00').value(BigInt(1)).gasLimit(BigInt(21000))).toBe(b);
  });
});
