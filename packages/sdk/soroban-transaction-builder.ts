/**
 * soroban-transaction-builder.ts — Immutable fluent Soroban transaction builder.
 *
 * Supports batching multiple contract invocations into one transaction, so the
 * batch requires one RPC simulation and one submission rather than one of each
 * per invocation.
 */

import {
  Account,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
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

export interface SorobanSubmitResponse {
  status: string;
  error?: string;
}

export interface SorobanSimulationServer {
  simulateTransaction(tx: Transaction): Promise<SorobanRpc.Api.SimulateTransactionResponse>;
}

export interface SorobanTransactionServer extends SorobanSimulationServer {
  sendTransaction(tx: Transaction): Promise<SorobanSubmitResponse>;
}

export class SorobanSubmissionError extends Error {
  readonly response: SorobanSubmitResponse;

  constructor(response: SorobanSubmitResponse) {
    super(`Soroban RPC rejected transaction with status ${response.status}${response.error ? `: ${response.error}` : ''}`);
    this.name = 'SorobanSubmissionError';
    this.response = response;
  }
}

const NETWORK_PASSPHRASES: Record<string, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
  public: Networks.PUBLIC,
  futurenet: Networks.FUTURENET,
  standalone: Networks.STANDALONE,
};

function validateInvocation(invocation: ContractInvocationOptions): void {
  if (!invocation.contractId || !invocation.method) {
    throw new Error('contractId and method are required for contract invocation');
  }
}

export class SorobanTransactionBuilder {
  private readonly options: Readonly<SorobanBuilderOptions>;

  constructor(options: SorobanBuilderOptions = {}) {
    this.options = Object.freeze({
      ...options,
      operations: options.operations ? [...options.operations] : [],
      contractInvocations: options.contractInvocations ? [...options.contractInvocations] : [],
    });
  }

  /** Set the source account for the transaction. */
  forAccount(account: Account | string, sequenceNumber?: string | number | bigint): SorobanTransactionBuilder {
    if (!account) throw new Error('Source account cannot be empty');
    return new SorobanTransactionBuilder({
      ...this.options,
      sourceAccount: account,
      sequenceNumber: sequenceNumber !== undefined ? String(sequenceNumber) : this.options.sequenceNumber,
    });
  }

  /** Set the network and passphrase, rejecting contradictory settings. */
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

    return new SorobanTransactionBuilder({ ...this.options, network, networkPassphrase: resolvedPassphrase });
  }

  /** Override the base fee in stroops. */
  withFee(fee: number | string): SorobanTransactionBuilder {
    const feeNum = typeof fee === 'number' ? fee : parseInt(fee, 10);
    if (isNaN(feeNum) || feeNum < 0) throw new Error('Fee must be a non-negative number');
    return new SorobanTransactionBuilder({ ...this.options, fee: String(fee) });
  }

  /** Set the validity timeout for the transaction in seconds. */
  withTimeout(seconds: number): SorobanTransactionBuilder {
    if (typeof seconds !== 'number' || seconds <= 0) {
      throw new Error('Timeout must be a positive number of seconds');
    }
    return new SorobanTransactionBuilder({ ...this.options, timeoutSeconds: seconds });
  }

  /** Attach an optional memo to the transaction. */
  withMemo(memo: Memo | string): SorobanTransactionBuilder {
    return new SorobanTransactionBuilder({
      ...this.options,
      memo: typeof memo === 'string' ? Memo.text(memo) : memo,
    });
  }

  /** Queue one Soroban smart contract invocation. */
  invokeContract(invocation: ContractInvocationOptions): SorobanTransactionBuilder {
    return this.invokeContracts([invocation]);
  }

  /**
   * Queue several contract calls in one immutable copy operation.
   * This avoids repeated array copies when constructing large batches; all
   * calls are simulated and submitted together as one Stellar transaction.
   */
  invokeContracts(invocations: readonly ContractInvocationOptions[]): SorobanTransactionBuilder {
    for (const invocation of invocations) validateInvocation(invocation);
    if (invocations.length === 0) return this;
    return new SorobanTransactionBuilder({
      ...this.options,
      contractInvocations: [...(this.options.contractInvocations ?? []), ...invocations],
    });
  }

  /** Add a raw Stellar operation. */
  addOperation(operation: xdr.Operation): SorobanTransactionBuilder {
    return new SorobanTransactionBuilder({
      ...this.options,
      operations: [...(this.options.operations ?? []), operation],
    });
  }

  /** Add a native or asset payment operation. */
  addPayment(options: PaymentOperationOptions): SorobanTransactionBuilder {
    return this.addOperation(Operation.payment({
      destination: options.destination,
      amount: options.amount,
      asset: options.asset ?? Asset.native(),
    }));
  }

  /** Simulate the transaction using a Soroban RPC server. */
  async simulate(rpcServer: SorobanSimulationServer): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    return rpcServer.simulateTransaction(this.buildRawTransaction());
  }

  /** Attach successful simulation results (resource fees and footprints). */
  assemble(simulationResult: SorobanRpc.Api.SimulateTransactionResponse): SorobanTransactionBuilder {
    return new SorobanTransactionBuilder({ ...this.options, simulationResult });
  }

  /**
   * Simulate, assemble, sign, and submit this transaction.
   * The returned RPC response is intentionally exposed: callers should handle
   * retryable statuses such as TRY_AGAIN_LATER and must not blindly retry an
   * ambiguous network failure, since the original transaction may have landed.
   */
  async simulateAndSubmit(
    rpcServer: SorobanTransactionServer,
    signers: readonly Keypair[],
  ): Promise<{
    transaction: Transaction;
    simulation: SorobanRpc.Api.SimulateTransactionResponse;
    submission: SorobanSubmitResponse;
  }> {
    if (signers.length === 0) throw new Error('At least one signer is required to submit a transaction');

    const simulation = await this.simulate(rpcServer);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new Error(`Cannot submit failed simulation: ${simulation.error ?? 'Unknown simulation error'}`);
    }

    const transaction = this.assemble(simulation).build();
    transaction.sign(...signers);
    const submission = await rpcServer.sendTransaction(transaction);
    if (submission.status === 'ERROR') throw new SorobanSubmissionError(submission);

    return { transaction, simulation, submission };
  }

  /** Build the final Stellar transaction, ready for signing and submission. */
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

  /** Serialize the built transaction to XDR string. */
  toXDR(): string {
    return this.build().toXDR();
  }

  /** Inspect current configuration without leaking secrets. */
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

  private buildRawTransaction(): Transaction {
    if (!this.options.sourceAccount) throw new Error('sourceAccount is required to build a transaction');

    const networkPassphrase =
      this.options.networkPassphrase ??
      (this.options.network ? NETWORK_PASSPHRASES[this.options.network.toLowerCase()] : undefined);
    if (!networkPassphrase) throw new Error('Network or networkPassphrase is required to build a transaction');

    const account = this.options.sourceAccount instanceof Account
      ? this.options.sourceAccount
      : new Account(this.options.sourceAccount, this.options.sequenceNumber ?? '0');

    const txBuilder = new TransactionBuilder(account, {
      fee: this.options.fee ?? String(BASE_FEE),
      networkPassphrase,
    });
    txBuilder.setTimeout(this.options.timeoutSeconds ?? 30);

    if (this.options.memo) {
      txBuilder.addMemo(typeof this.options.memo === 'string' ? Memo.text(this.options.memo) : this.options.memo);
    }

    let opCount = 0;
    for (const operation of this.options.operations ?? []) {
      txBuilder.addOperation(operation);
      opCount += 1;
    }

    for (const invocation of this.options.contractInvocations ?? []) {
      const contract = new Contract(invocation.contractId);
      const convertedArgs = (invocation.args ?? []).map((arg) => {
        if (arg && typeof arg === 'object' && ('_arm' in (arg as object) || '_switch' in (arg as object))) {
          return arg as xdr.ScVal;
        }
        return nativeToScVal(arg);
      });
      txBuilder.addOperation(contract.call(invocation.method, ...convertedArgs));
      opCount += 1;
    }

    if (opCount === 0) throw new Error('At least one operation or contract invocation is required');
    return txBuilder.build();
  }
}

/** Factory helper for creating a new fluent Soroban transaction builder. */
export function createSorobanTransactionBuilder(options?: SorobanBuilderOptions): SorobanTransactionBuilder {
  return new SorobanTransactionBuilder(options);
}
