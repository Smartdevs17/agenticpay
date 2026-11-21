import { describe, it, expect, vi } from 'vitest';
import {
  SorobanTransactionBuilder,
  createSorobanTransactionBuilder,
} from '../soroban-transaction-builder.js';
import { Account, Keypair, Networks, Operation, Asset, SorobanRpc } from '@stellar/stellar-sdk';

describe('SorobanTransactionBuilder fluent API', () => {
  const kp = Keypair.random();
  const destKp = Keypair.random();

  it('builds a valid Soroban transaction with fluent chaining', () => {
    const builder = createSorobanTransactionBuilder()
      .forAccount(kp.publicKey(), '1')
      .withNetwork('testnet')
      .withFee(200)
      .withTimeout(45)
      .withMemo('test-memo')
      .addPayment({
        destination: destKp.publicKey(),
        amount: '10.5',
      });

    const tx = builder.build();
    expect(tx).toBeDefined();
    expect(tx.fee).toBe('200');
    expect(tx.memo.value).toBe('test-memo');
    expect(tx.operations.length).toBe(1);

    const xdr = builder.toXDR();
    expect(xdr).toBeTruthy();
    expect(typeof xdr).toBe('string');
  });

  it('rejects missing sourceAccount on build', () => {
    const builder = createSorobanTransactionBuilder()
      .withNetwork('testnet')
      .addPayment({ destination: destKp.publicKey(), amount: '1.0' });

    expect(() => builder.build()).toThrow('sourceAccount is required');
  });

  it('rejects missing network on build', () => {
    const builder = createSorobanTransactionBuilder()
      .forAccount(kp.publicKey(), '0')
      .addPayment({ destination: destKp.publicKey(), amount: '1.0' });

    expect(() => builder.build()).toThrow('Network or networkPassphrase is required');
  });

  it('rejects missing operations on build', () => {
    const builder = createSorobanTransactionBuilder()
      .forAccount(kp.publicKey(), '0')
      .withNetwork('testnet');

    expect(() => builder.build()).toThrow('At least one operation or contract invocation is required');
  });

  it('loudly rejects network passphrase mismatch', () => {
    expect(() =>
      createSorobanTransactionBuilder().withNetwork('mainnet', Networks.TESTNET),
    ).toThrow('Network passphrase mismatch');
  });

  it('enforces immutability so builder state never leaks across branches', () => {
    const base = createSorobanTransactionBuilder()
      .forAccount(kp.publicKey(), '10')
      .withNetwork('testnet')
      .withFee(100);

    const branch1 = base.withFee(500).withMemo('memo-1').addPayment({
      destination: destKp.publicKey(),
      amount: '5.0',
    });

    const branch2 = base.withFee(1000).withMemo('memo-2').addPayment({
      destination: destKp.publicKey(),
      amount: '20.0',
    });

    const tx1 = branch1.build();
    const tx2 = branch2.build();

    expect(tx1.fee).toBe('500');
    expect(tx1.memo.value).toBe('memo-1');

    expect(tx2.fee).toBe('1000');
    expect(tx2.memo.value).toBe('memo-2');

    // Base remained unmodified
    const inspect = base.inspect();
    expect(inspect.fee).toBe('100');
    expect(inspect.hasMemo).toBe(false);
    expect(inspect.operationCount).toBe(0);
  });

  it('handles contract invocations with ScVal conversion', () => {
    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
    const builder = createSorobanTransactionBuilder()
      .forAccount(kp.publicKey(), '5')
      .withNetwork('testnet')
      .invokeContract({
        contractId,
        method: 'transfer',
        args: [destKp.publicKey(), 1000],
      });

    const tx = builder.build();
    expect(tx.operations.length).toBe(1);
    expect(builder.toXDR()).toBeTruthy();
  });

  it('supports simulation and transaction assembly', async () => {
    const fakeSimResult = {
      minResourceFee: '150',
      results: [],
      latestLedger: 12345,
    } as unknown as SorobanRpc.Api.SimulateTransactionResponse;

    const mockRpc = {
      simulateTransaction: vi.fn().mockResolvedValue(fakeSimResult),
    };

    const builder = createSorobanTransactionBuilder()
      .forAccount(kp.publicKey(), '1')
      .withNetwork('testnet')
      .addPayment({ destination: destKp.publicKey(), amount: '1.0' });

    const sim = await builder.simulate(mockRpc);
    expect(sim).toBe(fakeSimResult);
    expect(mockRpc.simulateTransaction).toHaveBeenCalled();
  });
});
