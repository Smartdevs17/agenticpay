/**
 * TypeScript bindings for the Soroban Swap Aggregator contract.
 *
 * Wraps the Stellar SDK's SorobanRpc + contract invocation helpers so callers
 * can interact with the aggregator without touching raw XDR.
 *
 * Issue #458 — Implement Stellar Soroban Token Swap Aggregator
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RouteLeg {
  /** Short DEX identifier (e.g. "phoenix", "aquarius"). */
  dexId: string;
  /** On-chain DEX router contract address (Strkey). */
  dexAddress: string;
  tokenIn: string;
  tokenOut: string;
  /** Fraction of total input routed here, in basis points (sum ≤ 10 000). */
  splitBps: number;
  /** Simulated output for this leg. */
  expectedOut: bigint;
}

export interface SwapRoute {
  legs: RouteLeg[];
  expectedOut: bigint;
  /** DEX fees estimated across all legs (in token_out units). */
  dexFees: bigint;
  isMultiHop: boolean;
}

export interface SwapQuote {
  route: SwapRoute;
  expectedOut: bigint;
  /** Hard floor: actual output must be ≥ this or the tx reverts. */
  minAmountOut: bigint;
  slippageBps: number;
  /** Estimated price impact in basis points. */
  priceImpactBps: number;
  /** Whether split routing was used. */
  isSplit: boolean;
  /** Ledger sequence at which the quote was generated. */
  quotedAtLedger: number;
}

export interface SwapResult {
  /** Net output received (after protocol fee). */
  amountOut: bigint;
  txHash: string;
  quote: SwapQuote;
}

export interface DexInfo {
  dexId: string;
  dexAddress: string;
}

export interface AggregatorConfig {
  /** Deployed aggregator contract address (Strkey). */
  contractAddress: string;
  /** Soroban RPC endpoint URL. */
  rpcUrl: string;
  /** "testnet" | "mainnet" */
  network: 'testnet' | 'mainnet';
}

// ─── Error types ─────────────────────────────────────────────────────────────

export class AggregatorError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = 'AggregatorError';
  }
}

/** Maps on-chain error codes to human-readable messages. */
export const AGGREGATOR_ERROR_CODES: Record<number, string> = {
  1: 'AlreadyInitialized',
  2: 'Unauthorized',
  3: 'NoDexAvailable',
  4: 'NoRouteFound',
  5: 'SlippageTooHigh',
  6: 'SlippageExceeded',
  7: 'PriceImpactTooHigh',
  8: 'InvalidAmount',
  9: 'FeeTooHigh',
  10: 'DexCallFailed',
  11: 'AllRoutesFailed',
  12: 'InsufficientLiquidity',
  13: 'PartialFillDetected',
  14: 'NotInitialized',
};

// ─── XDR helpers ─────────────────────────────────────────────────────────────

/**
 * Decode the ScVal returned by `get_quote` into a `SwapQuote` object.
 * The contract serialises the quote as a Soroban struct (map of fields).
 */
export function decodeSwapQuote(scVal: unknown): SwapQuote {
  // In production this would use @stellar/stellar-sdk's scValToNative or a
  // generated contract client.  The shape mirrors the Rust `SwapQuote` struct.
  const v = scVal as Record<string, unknown>;
  return {
    route: decodeSwapRoute(v['route']),
    expectedOut: BigInt(String(v['expected_out'] ?? 0)),
    minAmountOut: BigInt(String(v['min_amount_out'] ?? 0)),
    slippageBps: Number(v['slippage_bps'] ?? 0),
    priceImpactBps: Number(v['price_impact_bps'] ?? 0),
    isSplit: Boolean(v['is_split']),
    quotedAtLedger: Number(v['quoted_at_ledger'] ?? 0),
  };
}

function decodeSwapRoute(raw: unknown): SwapRoute {
  const v = raw as Record<string, unknown>;
  const rawLegs = (v['legs'] as unknown[]) ?? [];
  return {
    legs: rawLegs.map(decodeRouteLeg),
    expectedOut: BigInt(String(v['expected_out'] ?? 0)),
    dexFees: BigInt(String(v['dex_fees'] ?? 0)),
    isMultiHop: Boolean(v['is_multi_hop']),
  };
}

function decodeRouteLeg(raw: unknown): RouteLeg {
  const v = raw as Record<string, unknown>;
  return {
    dexId: String(v['dex_id'] ?? ''),
    dexAddress: String(v['dex_address'] ?? ''),
    tokenIn: String(v['token_in'] ?? ''),
    tokenOut: String(v['token_out'] ?? ''),
    splitBps: Number(v['split_bps'] ?? 0),
    expectedOut: BigInt(String(v['expected_out'] ?? 0)),
  };
}

// ─── Client class ─────────────────────────────────────────────────────────────

/**
 * High-level client for the Soroban Swap Aggregator contract.
 *
 * @example
 * ```ts
 * const client = new SorobanSwapAggregatorClient({
 *   contractAddress: 'C...',
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   network: 'testnet',
 * });
 *
 * const quote = await client.getQuote({
 *   tokenIn:  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
 *   tokenOut: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
 *   amountIn: 100_000_000n, // 10 XLM (7 decimals)
 *   slippageBps: 100,       // 1 %
 * });
 * ```
 */
export class SorobanSwapAggregatorClient {
  private readonly contractAddress: string;
  private readonly rpcUrl: string;
  private readonly network: 'testnet' | 'mainnet';

  constructor(config: AggregatorConfig) {
    this.contractAddress = config.contractAddress;
    this.rpcUrl = config.rpcUrl;
    this.network = config.network;
  }

  // ── Admin ──────────────────────────────────────────────────────────────

  /**
   * Build the XDR for `initialize(admin, fee_bps)`.
   * The caller signs and submits the transaction.
   */
  buildInitializeTx(params: { admin: string; feeBps: number }): Record<string, unknown> {
    return this.buildInvocation('initialize', [
      { type: 'address', value: params.admin },
      { type: 'u32', value: params.feeBps },
    ]);
  }

  /** Build XDR for `add_dex(dex_id, dex_address)`. */
  buildAddDexTx(params: { dexId: string; dexAddress: string }): Record<string, unknown> {
    return this.buildInvocation('add_dex', [
      { type: 'string', value: params.dexId },
      { type: 'address', value: params.dexAddress },
    ]);
  }

  /** Build XDR for `remove_dex(dex_id)`. */
  buildRemoveDexTx(params: { dexId: string }): Record<string, unknown> {
    return this.buildInvocation('remove_dex', [
      { type: 'string', value: params.dexId },
    ]);
  }

  /** Build XDR for `set_fee(fee_bps)`. */
  buildSetFeeTx(params: { feeBps: number }): Record<string, unknown> {
    return this.buildInvocation('set_fee', [
      { type: 'u32', value: params.feeBps },
    ]);
  }

  // ── Quoting ────────────────────────────────────────────────────────────

  /**
   * Simulate a swap and return the best route.
   * This is a read-only simulation; no transaction is submitted.
   */
  async getQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    slippageBps: number;
  }): Promise<SwapQuote> {
    const args = [
      { type: 'address', value: params.tokenIn },
      { type: 'address', value: params.tokenOut },
      { type: 'i128', value: params.amountIn.toString() },
      { type: 'u32', value: params.slippageBps },
    ];
    const raw = await this.simulateInvocation('get_quote', args);
    return decodeSwapQuote(raw);
  }

  // ── Execution ──────────────────────────────────────────────────────────

  /**
   * Build the XDR for `swap(caller, token_in, token_out, amount_in, min_amount_out, slippage_bps)`.
   *
   * The caller must pre-approve the aggregator contract for `amountIn` of `tokenIn`.
   */
  buildSwapTx(params: {
    caller: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    minAmountOut: bigint;
    slippageBps: number;
  }): Record<string, unknown> {
    return this.buildInvocation('swap', [
      { type: 'address', value: params.caller },
      { type: 'address', value: params.tokenIn },
      { type: 'address', value: params.tokenOut },
      { type: 'i128', value: params.amountIn.toString() },
      { type: 'i128', value: params.minAmountOut.toString() },
      { type: 'u32', value: params.slippageBps },
    ]);
  }

  // ── Views ──────────────────────────────────────────────────────────────

  /** Return all whitelisted DEX IDs. */
  async listDexes(): Promise<string[]> {
    const raw = await this.simulateInvocation('list_dexes', []);
    return Array.isArray(raw) ? (raw as string[]) : [];
  }

  /** Return the current admin address. */
  async admin(): Promise<string> {
    const raw = await this.simulateInvocation('admin', []);
    return String(raw);
  }

  /** Return the current protocol fee in basis points. */
  async feeBps(): Promise<number> {
    const raw = await this.simulateInvocation('fee_bps', []);
    return Number(raw);
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /** Build a contract invocation descriptor (consumed by the Stellar SDK). */
  private buildInvocation(
    method: string,
    args: Array<{ type: string; value: unknown }>,
  ): Record<string, unknown> {
    return {
      contractAddress: this.contractAddress,
      method,
      args,
      network: this.network,
      rpcUrl: this.rpcUrl,
    };
  }

  /**
   * Simulate a contract call via the Soroban RPC `simulateTransaction` endpoint.
   * Returns the decoded result value.
   *
   * In a real integration this would use `@stellar/stellar-sdk`'s
   * `SorobanRpc.Server.simulateTransaction`.
   */
  private async simulateInvocation(
    method: string,
    args: Array<{ type: string; value: unknown }>,
  ): Promise<unknown> {
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: {
        transaction: this.buildInvocation(method, args),
      },
    };

    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new AggregatorError(
        `RPC request failed: ${response.statusText}`,
        0,
      );
    }

    const json = (await response.json()) as { result?: { results?: Array<{ xdr: string }> }; error?: { code: number; message: string } };

    if (json.error) {
      const code = json.error.code ?? 0;
      const msg = AGGREGATOR_ERROR_CODES[code] ?? json.error.message;
      throw new AggregatorError(msg, code);
    }

    // In production: decode the returned XDR with stellar-sdk's xdr.ScVal.fromXDR()
    return json.result?.results?.[0] ?? null;
  }
}
