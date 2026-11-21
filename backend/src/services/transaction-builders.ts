/**
 * Issue #486 — Blockchain Transaction Builder Pattern
 *
 * Abstract base class + chain-specific implementations:
 *   - SorobanTransactionBuilder  (Stellar / Soroban)
 *   - EVMTransactionBuilder      (EVM-compatible chains)
 */

// ── Abstract base ─────────────────────────────────────────────────────────────

export interface BuiltTransaction {
  chain: 'soroban' | 'evm';
  /** Serialised transaction ready for broadcast */
  serialised: string;
  /** Estimated fee in the chain's native unit */
  estimatedFee: string;
}

export abstract class TransactionBuilder<T extends BuiltTransaction = BuiltTransaction> {
  protected _to?: string;
  protected _value?: bigint;
  protected _data?: string;
  protected _gasLimit?: bigint;
  protected _nonce?: number;

  to(address: string): this { this._to = address; return this; }
  value(amount: bigint): this { this._value = amount; return this; }
  data(hex: string): this { this._data = hex; return this; }
  gasLimit(limit: bigint): this { this._gasLimit = limit; return this; }
  nonce(n: number): this { this._nonce = n; return this; }

  /** Estimate fee before building */
  abstract estimateFee(): Promise<string>;

  /** Simulate transaction (dry-run) */
  abstract simulate(): Promise<{ success: boolean; result?: string; error?: string }>;

  /** Build and serialise the transaction */
  abstract build(): Promise<T>;

  /** Sign the built transaction */
  abstract sign(secretOrKey: string): Promise<string>;
}

// ── Soroban implementation ────────────────────────────────────────────────────

import {
  TransactionBuilder as StellarTxBuilder,
  Networks,
  Operation,
  Asset,
  Keypair,
  Account,
  BASE_FEE,
} from '@stellar/stellar-sdk';

export interface SorobanBuiltTransaction extends BuiltTransaction {
  chain: 'soroban';
  networkPassphrase: string;
}

export class SorobanTransactionBuilder extends TransactionBuilder<SorobanBuiltTransaction> {
  private _contractId?: string;
  private _method?: string;
  private _args?: unknown[];
  private _sourceAccount?: string;
  private _network: 'testnet' | 'mainnet';

  constructor(network: 'testnet' | 'mainnet' = 'testnet') {
    super();
    this._network = network;
  }

  call(contractId: string, method: string, args: unknown[] = []): this {
    this._contractId = contractId;
    this._method = method;
    this._args = args;
    return this;
  }

  source(publicKey: string): this {
    this._sourceAccount = publicKey;
    return this;
  }

  async estimateFee(): Promise<string> {
    return BASE_FEE;
  }

  async simulate(): Promise<{ success: boolean; result?: string; error?: string }> {
    // Stub: production impl would call server.simulateTransaction
    if (!this._contractId || !this._method) {
      return { success: false, error: 'contractId and method are required' };
    }
    return { success: true, result: 'simulated' };
  }

  async build(): Promise<SorobanBuiltTransaction> {
    if (!this._sourceAccount) throw new Error('source account is required');

    const networkPassphrase =
      this._network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;

    // Build a minimal payment operation as a stand-in for a contract call
    // (full Soroban contract invocation requires a live RPC; this shows the builder pattern)
    const account = new Account(this._sourceAccount, String(this._nonce ?? 0));
    const builder = new StellarTxBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    });

    if (this._to && this._value !== undefined) {
      builder.addOperation(
        Operation.payment({
          destination: this._to,
          asset: Asset.native(),
          amount: (Number(this._value) / 1e7).toFixed(7),
        }),
      );
    } else {
      builder.addOperation(Operation.manageData({ name: this._method ?? 'call', value: null }));
    }

    const tx = builder.setTimeout(30).build();

    return {
      chain: 'soroban',
      serialised: tx.toXDR(),
      estimatedFee: await this.estimateFee(),
      networkPassphrase,
    };
  }

  async sign(secretKey: string): Promise<string> {
    const built = await this.build();
    const networkPassphrase =
      this._network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;

    const { Transaction } = await import('@stellar/stellar-sdk');
    const tx = new Transaction(built.serialised, networkPassphrase);
    tx.sign(Keypair.fromSecret(secretKey));
    return tx.toXDR();
  }
}

// ── EVM implementation ────────────────────────────────────────────────────────

import { ethers } from 'ethers';

export interface EVMBuiltTransaction extends BuiltTransaction {
  chain: 'evm';
  chainId: number;
}

export class EVMTransactionBuilder extends TransactionBuilder<EVMBuiltTransaction> {
  private _chainId: number;
  private _contractAbi?: ethers.InterfaceAbi;
  private _method?: string;
  private _args?: unknown[];
  private _provider?: ethers.JsonRpcProvider;

  constructor(chainId = 1, rpcUrl?: string) {
    super();
    this._chainId = chainId;
    if (rpcUrl) this._provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  /** Set ABI for contract calls with automatic calldata encoding */
  abi(abi: ethers.InterfaceAbi): this {
    this._contractAbi = abi;
    return this;
  }

  call(method: string, args: unknown[] = []): this {
    this._method = method;
    this._args = args;
    return this;
  }

  async estimateFee(): Promise<string> {
    if (!this._provider || !this._to) return '21000';
    try {
      const gas = await this._provider.estimateGas({
        to: this._to,
        value: this._value,
        data: this._data,
      });
      return gas.toString();
    } catch {
      return '21000';
    }
  }

  async simulate(): Promise<{ success: boolean; result?: string; error?: string }> {
    if (!this._provider || !this._to) {
      return { success: false, error: 'provider and to are required for simulation' };
    }
    try {
      const result = await this._provider.call({
        to: this._to,
        value: this._value,
        data: this._data,
      });
      return { success: true, result };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async build(): Promise<EVMBuiltTransaction> {
    if (!this._to) throw new Error('to address is required');

    let calldata = this._data;
    if (this._contractAbi && this._method) {
      const iface = new ethers.Interface(this._contractAbi);
      calldata = iface.encodeFunctionData(this._method, this._args ?? []);
    }

    const tx: ethers.TransactionRequest = {
      to: this._to,
      value: this._value,
      data: calldata,
      gasLimit: this._gasLimit,
      nonce: this._nonce,
      chainId: this._chainId,
    };

    return {
      chain: 'evm',
      serialised: JSON.stringify(tx),
      estimatedFee: await this.estimateFee(),
      chainId: this._chainId,
    };
  }

  async sign(privateKey: string): Promise<string> {
    const built = await this.build();
    const tx: ethers.TransactionRequest = JSON.parse(built.serialised);
    const wallet = new ethers.Wallet(privateKey);
    return wallet.signTransaction(tx);
  }
}
