/**
 * soroban-transaction-builder.ts — Consolidate Soroban transaction builders into a single fluent API (#1416)
 *
 * Provides a type-safe, immutable fluent builder for constructing, simulating,
 * and assembling Soroban transactions with checked fee, timeout, and network handling.
 */

import StellarSdk, {
  Account,
  Asset,
  BASE_FEE,
  Contract,
  Memo,
  Networks,
  Operation,
  SorobanRpc,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';

export type SorobanNetwork = 'testnet' | 'mainnet' | 'public' | 'futurenet' | 'standalone' | (string & {});

export interface ContractInvocationOptions {
  contractId: string;
  method: string;
  args?: unknown[] | xdr.ScVal[];
}

export interface PaymentOperationOptions {
  destination: string;
  amount: string;
  asset?: Asset;
}

export interface SorobanBuilderOptions {
  sourceAccount?: Account | string;
  sequenceNumber?: string;
  network?: SorobanNetwork;
  networkPassphrase?: string;
  fee?: string;
  timeoutSeconds?: number;
  memo?: Memo | string;
  operations?: xdr.Operation[];
  contractInvocations?: ContractInvocationOptions[];
  simulationResult?: SorobanRpc.Api.SimulateTransactionResponse;
}

const NETWORK_PASSPHRASES: Record<string, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
  public: Networks.PUBLIC,
  futurenet: Networks.FUTURENET,
  standalone: Networks.STANDALONE,
};

export class SorobanTransactionBuilder {
  private readonly options: Readonly<SorobanBuilderOptions>;

  constructor(options: SorobanBuilderOptions = {}) {
    this.options = Object.freeze({
      ...options,
      operations: options.operations ? [...options.operations] : [],
      contractInvocations: options.contractInvocations ? [...options.contractInvocations] : [],
    });
  }

  /**
   * Set the source account for the transaction.
   * Can accept a loaded StellarSdk.Account or a public key string with optional sequence.
   */
  forAccount(account: Account | string, sequenceNumber?: string | number | bigint): SorobanTransactionBuilder {
    if (!account) {
      throw new Error('Source account cannot be empty');
    }
    return new SorobanTransactionBuilder({
      ...this.options,
      sourceAccount: account,
      sequenceNumber: sequenceNumber !== undefined ? String(sequenceNumber) : this.options.sequenceNumber,
    });
  }

  /**
   * Set the network and passphrase.
   * Validates that network name and explicit passphrase do not conflict.
   */
  withNetwork(network: SorobanNetwork, networkPassphrase?: string): SorobanTransactionBuilder {
    const canonicalPassphrase = NETWORK_PASSPHRASES[network.toLowerCase()];
    if (canonicalPassphrase && networkPassphrase && canonicalPassphrase !== networkPassphrase) {
      throw new Error(
        `Network passphrase mismatch: specified "${network}" which expects "${canonicalPassphrase}", but got "${networkPassphrase}"`,
      );
    }

    const resolvedPassphrase = networkPassphrase ?? canonicalPassphrase;
    if (!resolvedPassphrase) {
      throw new Error(`Unknown network "${network}" without an explicit networkPassphrase`);
    }

    return new SorobanTransactionBuilder({
      ...this.options,
      network,
      networkPassphrase: resolvedPassphrase,
    });
  }

  /**
   * Override the base fee in stroops.
   */
  withFee(fee: number | string): SorobanTransactionBuilder {
    const feeNum = typeof fee === 'number' ? fee : parseInt(fee, 10);
    if (isNaN(feeNum) || feeNum < 0) {
      throw new Error('Fee must be a non-negative number');
    }
    return new SorobanTransactionBuilder({
      ...this.options,
      fee: String(fee),
    });
  }

  /**
   * Set the validity timeout for the transaction in seconds.
   */
  withTimeout(seconds: number): SorobanTransactionBuilder {
    if (typeof seconds !== 'number' || seconds <= 0) {
      throw new Error('Timeout must be a positive number of seconds');
    }
    return new SorobanTransactionBuilder({
      ...this.options,
      timeoutSeconds: seconds,
    });
  }

  /**
   * Attach an optional memo to the transaction.
   */
  withMemo(memo: Memo | string): SorobanTransactionBuilder {
    const memoObj = typeof memo === 'string' ? Memo.text(memo) : memo;
    return new SorobanTransactionBuilder({
      ...this.options,
      memo: memoObj,
    });
  }

  /**
   * Queue a Soroban smart contract invocation.
   */
  invokeContract(invocation: ContractInvocationOptions): SorobanTransactionBuilder {
    if (!invocation.contractId || !invocation.method) {
      throw new Error('contractId and method are required for contract invocation');
    }

    return new SorobanTransactionBuilder({
      ...this.options,
      contractInvocations: [...(this.options.contractInvocations ?? []), invocation],
    });
  }

  /**
   * Add a raw Stellar operation.
   */
  addOperation(operation: xdr.Operation): SorobanTransactionBuilder {
    return new SorobanTransactionBuilder({
      ...this.options,
      operations: [...(this.options.operations ?? []), operation],
    });
  }

  /**
   * Helper to add a native or asset payment operation.
   */
  addPayment(options: PaymentOperationOptions): SorobanTransactionBuilder {
    const op = Operation.payment({
      destination: options.destination,
      amount: options.amount,
      asset: options.asset ?? Asset.native(),
    });
    return this.addOperation(op);
  }

  /**
   * Simulate the transaction using a Soroban RPC server.
   */
  async simulate(rpcServer: {
    simulateTransaction: (tx: Transaction) => Promise<SorobanRpc.Api.SimulateTransactionResponse>;
  }): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    const tx = this.buildRawTransaction();
    return rpcServer.simulateTransaction(tx);
  }

  /**
   * Assemble transaction with simulation results (resource fees and footprints).
   */
  assemble(simulationResult: SorobanRpc.Api.SimulateTransactionResponse): SorobanTransactionBuilder {
    return new SorobanTransactionBuilder({
      ...this.options,
      simulationResult,
    });
  }

  /**
   * Build the final Stellar Transaction ready for signing and submission.
   */
  build(): Transaction {
    const rawTx = this.buildRawTransaction();

    if (this.options.simulationResult) {
      if (SorobanRpc.Api.isSimulationError(this.options.simulationResult)) {
        throw new Error(
          `Cannot assemble failed simulation: ${this.options.simulationResult.error ?? 'Unknown simulation error'}`,
        );
      }
      return SorobanRpc.assembleTransaction(rawTx, this.options.simulationResult).build();
    }

    return rawTx;
  }

  /**
   * Serialize the built transaction to XDR string.
   */
  toXDR(): string {
    return this.build().toXDR();
  }

  /**
   * Inspect current configuration without leaking secrets.
   */
  inspect(): {
    network?: string;
    sourceAccount?: string;
    fee: string;
    timeoutSeconds: number;
    hasMemo: boolean;
    operationCount: number;
    contractInvocationCount: number;
  } {
    return {
      network: this.options.network,
      sourceAccount:
        typeof this.options.sourceAccount === 'string'
          ? this.options.sourceAccount
          : this.options.sourceAccount?.accountId(),
      fee: this.options.fee ?? String(BASE_FEE),
      timeoutSeconds: this.options.timeoutSeconds ?? 30,
      hasMemo: !!this.options.memo,
      operationCount: (this.options.operations?.length ?? 0) + (this.options.contractInvocations?.length ?? 0),
      contractInvocationCount: this.options.contractInvocations?.length ?? 0,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildRawTransaction(): Transaction {
    if (!this.options.sourceAccount) {
      throw new Error('sourceAccount is required to build a transaction');
    }

    const networkPassphrase =
      this.options.networkPassphrase ??
      (this.options.network ? NETWORK_PASSPHRASES[this.options.network.toLowerCase()] : undefined);

    if (!networkPassphrase) {
      throw new Error('Network or networkPassphrase is required to build a transaction');
    }

    const account =
      this.options.sourceAccount instanceof Account
        ? this.options.sourceAccount
        : new Account(this.options.sourceAccount, this.options.sequenceNumber ?? '0');

    const txBuilder = new TransactionBuilder(account, {
      fee: this.options.fee ?? String(BASE_FEE),
      networkPassphrase,
    });

    const timeout = this.options.timeoutSeconds ?? 30;
    txBuilder.setTimeout(timeout);

    if (this.options.memo) {
      const memo = typeof this.options.memo === 'string' ? Memo.text(this.options.memo) : this.options.memo;
      txBuilder.addMemo(memo);
    }

    let opCount = 0;

    // Add manual operations
    for (const op of this.options.operations ?? []) {
      txBuilder.addOperation(op);
      opCount += 1;
    }

    // Add contract calls
    for (const invocation of this.options.contractInvocations ?? []) {
      const contract = new Contract(invocation.contractId);
      const convertedArgs = (invocation.args ?? []).map((arg) => {
        if (arg && typeof arg === 'object' && ('_arm' in (arg as any) || '_switch' in (arg as any))) {
          return arg as xdr.ScVal;
        }
        return nativeToScVal(arg);
      });

      const callOp = contract.call(invocation.method, ...convertedArgs);
      txBuilder.addOperation(callOp);
      opCount += 1;
    }

    if (opCount === 0) {
      throw new Error('At least one operation or contract invocation is required');
    }

    return txBuilder.build();
  }
}

/**
 * Factory helper for creating a new fluent Soroban transaction builder.
 */
export function createSorobanTransactionBuilder(options?: SorobanBuilderOptions): SorobanTransactionBuilder {
  return new SorobanTransactionBuilder(options);
}
