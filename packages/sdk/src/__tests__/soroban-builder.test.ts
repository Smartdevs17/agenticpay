import { describe, it, expect, vi } from 'vitest';
import { Account, Keypair, Networks, Operation, Asset, SorobanRpc, Transaction } from '@stellar/stellar-sdk';
import {
  SorobanSubmissionError,
  SorobanTransactionBuilder,
  createSorobanTransactionBuilder,
} from '../soroban-transaction-builder.js';

describe('SorobanTransactionBuilder fluent API', () => {
  const kp = Keypair.random();
  const destKp = Keypair.random();

  it('builds a valid transaction with fluent chaining', () => {
    const builder = createSorobanTransactionBuilder()
      .forAccount(kp.publicKey(), '1')
      .withNetwork('testnet')
      .withFee(200)
      .withTimeout(45)
      .withMemo('test-memo')
      .addPayment({ destination: destKp.publicKey(), amount: '10.5' });

    const tx = builder.build();
    expect(tx.fee).toBe('200');
    expect(tx.memo.value).toBe('test-memo');
    expect(tx.operations.length).toBe(1);
    expect(typeof builder.toXDR()).toBe('string');
  });

  it('rejects missing sourceAccount, network, and operations', () => {
    const noAccount = createSorobanTransactionBuilder().withNetwork('testnet')
      .addPayment({ destination: destKp.publicKey(), amount: '1.0' });
    expect(() => noAccount.build()).toThrow('sourceAccount is required');

    const noNetwork = createSorobanTransactionBuilder().forAccount(kp.publicKey(), '0')
      .addPayment({ destination: destKp.publicKey(), amount: '1.0' });
    expect(() => noNetwork.build()).toThrow('Network or networkPassphrase is required');

    const noOperations = createSorobanTransactionBuilder().forAccount(kp.publicKey(), '0').withNetwork('testnet');
    expect(() => noOperations.build()).toThrow('At least one operation or contract invocation is required');
  });

  it('rejects network passphrase mismatch', () => {
    expect(() => createSorobanTransactionBuilder().withNetwork('mainnet', Networks.TESTNET))
      .toThrow('Network passphrase mismatch');
  });

  it('keeps builder branches immutable', () => {
    const base = createSorobanTransactionBuilder().forAccount(kp.publicKey(), '10').withNetwork('testnet').withFee(100);
    const branch1 = base.withFee(500).withMemo('memo-1').addPayment({ destination: destKp.publicKey(), amount: '5.0' });
    const branch2 = base.withFee(1000).withMemo('memo-2').addPayment({ destination: destKp.publicKey(), amount: '20.0' });

    expect(branch1.build().fee).toBe('500');
    expect(branch1.build().memo.value).toBe('memo-1');
    expect(branch2.build().fee).toBe('1000');
    expect(branch2.build().memo.value).toBe('memo-2');
    expect(base.inspect()).toMatchObject({ fee: '100', hasMemo: false, operationCount: 0 });
  });

  it('batches contract invocations in one builder copy', () => {
    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
    const base = createSorobanTransactionBuilder().forAccount(kp.publicKey(), '5').withNetwork('testnet');
    const batched = base.invokeContracts([
      { contractId, method: 'first', args: [1] },
      { contractId, method: 'second', args: [2] },
    ]);

    expect(base.inspect().operationCount).toBe(0);
    expect(batched.inspect()).toMatchObject({ operationCount: 2, contractInvocationCount: 2 });
    expect(batched.build().operations).toHaveLength(2);
  });

  it('validates a batch atomically', () => {
    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
    const base = createSorobanTransactionBuilder().forAccount(kp.publicKey(), '5').withNetwork('testnet');
    expect(() => base.invokeContracts([
      { contractId, method: 'valid' },
      { contractId, method: '' },
    ])).toThrow('contractId and method are required');
    expect(base.inspect().contractInvocationCount).toBe(0);
  });

  it('simulates and submits a signed batch once', async () => {
    const simulation = { minResourceFee: '150', results: [], latestLedger: 12345 } as unknown as SorobanRpc.Api.SimulateTransactionResponse;
    const transaction = { sign: vi.fn() } as unknown as Transaction;
    const builder = createSorobanTransactionBuilder().forAccount(kp.publicKey(), '1').withNetwork('testnet')
      .addPayment({ destination: destKp.publicKey(), amount: '1.0' });
    const simulate = vi.spyOn(builder, 'simulate').mockResolvedValue(simulation);
    vi.spyOn(builder, 'assemble').mockReturnValue(builder);
    vi.spyOn(builder, 'build').mockReturnValue(transaction);
    const rpc = {
      simulateTransaction: vi.fn(),
      sendTransaction: vi.fn().mockResolvedValue({ status: 'PENDING' }),
    };

    const result = await builder.simulateAndSubmit(rpc, [kp]);

    expect(simulate).toHaveBeenCalledOnce();
    expect(transaction.sign).toHaveBeenCalledWith(kp);
    expect(rpc.sendTransaction).toHaveBeenCalledOnce();
    expect(rpc.sendTransaction).toHaveBeenCalledWith(transaction);
    expect(result).toMatchObject({ transaction, simulation, submission: { status: 'PENDING' } });
  });

  it('does not submit when simulation fails', async () => {
    const failedSimulation = { error: 'invalid contract call' } as unknown as SorobanRpc.Api.SimulateTransactionResponse;
    const builder = createSorobanTransactionBuilder().forAccount(kp.publicKey(), '1').withNetwork('testnet')
      .addPayment({ destination: destKp.publicKey(), amount: '1.0' });
    vi.spyOn(builder, 'simulate').mockResolvedValue(failedSimulation);
    const rpc = { simulateTransaction: vi.fn(), sendTransaction: vi.fn() };

    await expect(builder.simulateAndSubmit(rpc, [kp])).rejects.toThrow('Cannot submit failed simulation');
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it('reports RPC transaction rejection and requires a signer', async () => {
    const builder = createSorobanTransactionBuilder().forAccount(kp.publicKey(), '1').withNetwork('testnet')
      .addPayment({ destination: destKp.publicKey(), amount: '1.0' });
    await expect(builder.simulateAndSubmit({
      simulateTransaction: vi.fn(), sendTransaction: vi.fn(),
    }, [])).rejects.toThrow('At least one signer is required');

    const simulation = { minResourceFee: '150', results: [], latestLedger: 12345 } as unknown as SorobanRpc.Api.SimulateTransactionResponse;
    const transaction = { sign: vi.fn() } as unknown as Transaction;
    vi.spyOn(builder, 'simulate').mockResolvedValue(simulation);
    vi.spyOn(builder, 'assemble').mockReturnValue(builder);
    vi.spyOn(builder, 'build').mockReturnValue(transaction);
    const rpc = { simulateTransaction: vi.fn(), sendTransaction: vi.fn().mockResolvedValue({ status: 'ERROR', error: 'bad sequence' }) };

    await expect(builder.simulateAndSubmit(rpc, [kp])).rejects.toBeInstanceOf(SorobanSubmissionError);
  });

  it('supports direct simulation without submission', async () => {
    const result = { minResourceFee: '150', results: [], latestLedger: 12345 } as unknown as SorobanRpc.Api.SimulateTransactionResponse;
    const mockRpc = { simulateTransaction: vi.fn().mockResolvedValue(result) };
    const builder = createSorobanTransactionBuilder().forAccount(kp.publicKey(), '1').withNetwork('testnet')
      .addPayment({ destination: destKp.publicKey(), amount: '1.0' });

    await expect(builder.simulate(mockRpc)).resolves.toBe(result);
    expect(mockRpc.simulateTransaction).toHaveBeenCalledOnce();
  });
});
