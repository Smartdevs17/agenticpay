/**
 * failure-analysis.ts — Issue #263
 *
 * Automated payment failure analysis with root cause detection.
 * Classifies blockchain transaction errors, parses revert reasons,
 * detects gas / nonce issues, and emits actionable resolution suggestions.
 */

// ── Error code catalogue ───────────────────────────────────────────────────────

export const ERROR_CODES = {
  INSUFFICIENT_GAS: 'INSUFFICIENT_GAS',
  NONCE_TOO_LOW: 'NONCE_TOO_LOW',
  NONCE_TOO_HIGH: 'NONCE_TOO_HIGH',
  NONCE_COLLISION: 'NONCE_COLLISION',
  REVERT: 'REVERT',
  REVERT_CUSTOM: 'REVERT_CUSTOM',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  GAS_PRICE_TOO_LOW: 'GAS_PRICE_TOO_LOW',
  CONTRACT_NOT_FOUND: 'CONTRACT_NOT_FOUND',
  ACCESS_CONTROL: 'ACCESS_CONTROL',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface FailureClassification {
  code: ErrorCode;
  severity: Severity;
  /** Human-readable description of the root cause. */
  rootCause: string;
  /** Ordered list of actions to resolve the issue. */
  resolutions: string[];
  /** Whether this failure pattern should trigger an alert. */
  shouldAlert: boolean;
  /** Parsed revert reason string, if available. */
  revertReason?: string;
}

export interface TransactionFailure {
  txHash?: string;
  errorMessage: string;
  revertData?: string;
  gasLimit?: bigint;
  gasUsed?: bigint;
  nonce?: number;
  timestamp?: Date;
  network?: string;
}

export interface FailureAnalysisResult extends FailureClassification {
  txHash?: string;
  analysedAt: Date;
  network?: string;
}

// ── Known revert selectors (4-byte function selectors used for custom errors) ──

const KNOWN_SELECTORS: Record<string, string> = {
  '0x08c379a0': 'Error(string)',      // standard require() revert
  '0x4e487b71': 'Panic(uint256)',     // solidity panic
  '0x45941a9e': 'AccessControlUnauthorized',
  '0x118cdaa7': 'OwnableUnauthorizedAccount',
};

// ── Pattern matchers ──────────────────────────────────────────────────────────

function parseRevertReason(data?: string): string | undefined {
  if (!data || data === '0x') return undefined;

  // Standard ABI-encoded Error(string): 0x08c379a0 + abi.encode(string)
  if (data.startsWith('0x08c379a0')) {
    try {
      const hex = data.slice(10); // remove selector
      const offset = parseInt(hex.slice(0, 64), 16);
      const length = parseInt(hex.slice(64, 128), 16);
      const msgHex = hex.slice(128, 128 + length * 2);
      return Buffer.from(msgHex, 'hex').toString('utf8');
    } catch {
      return 'Error(string) — could not decode';
    }
  }

  const selector = data.slice(0, 10);
  if (KNOWN_SELECTORS[selector]) {
    return KNOWN_SELECTORS[selector];
  }

  return `Custom error selector: ${selector}`;
}

function matchesPattern(msg: string, patterns: RegExp[]): boolean {
  const lower = msg.toLowerCase();
  return patterns.some((p) => p.test(lower));
}

// ── Core classifier ───────────────────────────────────────────────────────────

export function classifyFailure(failure: TransactionFailure): FailureClassification {
  const msg = failure.errorMessage ?? '';
  const revertReason = parseRevertReason(failure.revertData);

  // ── Insufficient gas ────────────────────────────────────────────────────────
  if (
    matchesPattern(msg, [/out of gas/i, /gas required exceeds allowance/i, /intrinsic gas/i]) ||
    (failure.gasUsed != null && failure.gasLimit != null && failure.gasUsed >= failure.gasLimit)
  ) {
    const suggestedGas =
      failure.gasUsed != null
        ? String(Math.ceil(Number(failure.gasUsed) * 1.3))
        : 'N/A';

    return {
      code: ERROR_CODES.INSUFFICIENT_GAS,
      severity: 'high',
      rootCause: `Transaction ran out of gas. Used ${failure.gasUsed ?? 'unknown'} / limit ${failure.gasLimit ?? 'unknown'}.`,
      resolutions: [
        `Increase gas limit to at least ${suggestedGas} (1.3× observed usage).`,
        'Enable gas estimation before submission.',
        'Check for unbounded loops in the contract.',
      ],
      shouldAlert: false,
      revertReason,
    };
  }

  // ── Nonce issues ───────────────────────────────────────────────────────────
  if (matchesPattern(msg, [/nonce too low/i, /replacement transaction underpriced/i, /already known/i])) {
    return {
      code: ERROR_CODES.NONCE_TOO_LOW,
      severity: 'medium',
      rootCause: 'Transaction nonce is lower than the current account nonce — a previous transaction at this nonce was already confirmed.',
      resolutions: [
        'Fetch the latest nonce with `eth_getTransactionCount("pending")` and resubmit.',
        'If using a nonce manager, force a refresh.',
      ],
      shouldAlert: false,
      revertReason,
    };
  }

  if (matchesPattern(msg, [/nonce too high/i, /future nonce/i])) {
    return {
      code: ERROR_CODES.NONCE_TOO_HIGH,
      severity: 'medium',
      rootCause: 'Transaction nonce is higher than expected — there may be a gap caused by stuck pending transactions.',
      resolutions: [
        'Check for stuck pending transactions and cancel or replace them.',
        'Use the current nonce from `eth_getTransactionCount("latest")`.',
      ],
      shouldAlert: true,
      revertReason,
    };
  }

  if (matchesPattern(msg, [/nonce.*collision/i, /duplicate.*nonce/i])) {
    return {
      code: ERROR_CODES.NONCE_COLLISION,
      severity: 'high',
      rootCause: 'Two transactions were submitted with the same nonce from the same account.',
      resolutions: [
        'Implement a per-account nonce mutex to serialise submissions.',
        'Use a nonce manager with atomic increment-and-lock semantics.',
      ],
      shouldAlert: true,
      revertReason,
    };
  }

  // ── Insufficient funds ─────────────────────────────────────────────────────
  if (matchesPattern(msg, [/insufficient funds/i, /sender doesn.*t have enough funds/i, /balance too low/i])) {
    return {
      code: ERROR_CODES.INSUFFICIENT_FUNDS,
      severity: 'high',
      rootCause: 'Sender account does not have enough balance to cover value + gas cost.',
      resolutions: [
        'Top up the sender account.',
        'Reduce the value or gas limit.',
        'Implement pre-flight balance checks before submission.',
      ],
      shouldAlert: true,
      revertReason,
    };
  }

  // ── Gas price too low ──────────────────────────────────────────────────────
  if (matchesPattern(msg, [/gas price too low/i, /max fee per gas.*too low/i, /underpriced/i])) {
    return {
      code: ERROR_CODES.GAS_PRICE_TOO_LOW,
      severity: 'medium',
      rootCause: 'Transaction gas price is below the network minimum or current base fee.',
      resolutions: [
        'Fetch the current `baseFeePerGas` from the latest block and add a reasonable priority fee.',
        'Use EIP-1559 fee estimation (`eth_feeHistory`).',
      ],
      shouldAlert: false,
      revertReason,
    };
  }

  // ── Access control ─────────────────────────────────────────────────────────
  if (
    matchesPattern(msg, [/access control/i, /not authorized/i, /onlyowner/i, /caller is not/i]) ||
    (revertReason && /Access|Unauthorized|Owner/i.test(revertReason))
  ) {
    return {
      code: ERROR_CODES.ACCESS_CONTROL,
      severity: 'high',
      rootCause: 'Caller does not have the required role or is not the contract owner.',
      resolutions: [
        'Verify the signing address matches the expected admin/owner.',
        'Check that the role has been granted via `grantRole` before calling.',
        'Review contract access control configuration.',
      ],
      shouldAlert: true,
      revertReason,
    };
  }

  // ── Signature invalid ──────────────────────────────────────────────────────
  if (matchesPattern(msg, [/invalid signature/i, /signature.*mismatch/i, /ecdsa.*invalid/i])) {
    return {
      code: ERROR_CODES.SIGNATURE_INVALID,
      severity: 'critical',
      rootCause: 'Transaction signature is invalid or was signed by the wrong key.',
      resolutions: [
        'Ensure the correct private key / signer is used.',
        'Verify the chain ID matches the network.',
        'Re-sign the transaction and resubmit.',
      ],
      shouldAlert: true,
      revertReason,
    };
  }

  // ── Contract revert ────────────────────────────────────────────────────────
  if (
    matchesPattern(msg, [/revert/i, /execution reverted/i, /transaction.*failed/i]) ||
    failure.revertData
  ) {
    const customError = revertReason && !revertReason.startsWith('Error(string)');
    return {
      code: customError ? ERROR_CODES.REVERT_CUSTOM : ERROR_CODES.REVERT,
      severity: 'high',
      rootCause: revertReason
        ? `Contract reverted: ${revertReason}`
        : 'Contract execution reverted — check require/revert conditions.',
      resolutions: [
        'Inspect the revert reason and check contract state preconditions.',
        'Use a static call (`eth_call`) to reproduce the failure without gas cost.',
        'Enable verbose revert data in your RPC provider.',
      ],
      shouldAlert: false,
      revertReason,
    };
  }

  // ── Network timeout ────────────────────────────────────────────────────────
  if (matchesPattern(msg, [/timeout/i, /network.*error/i, /connection.*refused/i, /econnreset/i])) {
    return {
      code: ERROR_CODES.NETWORK_TIMEOUT,
      severity: 'medium',
      rootCause: 'RPC request timed out or the network connection was lost.',
      resolutions: [
        'Retry with exponential back-off.',
        'Switch to a fallback RPC endpoint.',
        'Check network health and rate limits.',
      ],
      shouldAlert: false,
      revertReason,
    };
  }

  // ── Unknown ────────────────────────────────────────────────────────────────
  return {
    code: ERROR_CODES.UNKNOWN,
    severity: 'medium',
    rootCause: `Unclassified failure: ${msg.slice(0, 200)}`,
    resolutions: [
      'Inspect full transaction receipt and logs.',
      'Enable debug tracing on the RPC node.',
      'File a report if the pattern recurs.',
    ],
    shouldAlert: true,
    revertReason,
  };
}

// ── Failure analytics tracker ─────────────────────────────────────────────────

export class FailureAnalytics {
  private history: FailureAnalysisResult[] = [];
  private patternCounts = new Map<ErrorCode, number>();

  analyse(failure: TransactionFailure): FailureAnalysisResult {
    const classification = classifyFailure(failure);
    const result: FailureAnalysisResult = {
      ...classification,
      txHash: failure.txHash,
      analysedAt: new Date(),
      network: failure.network,
    };

    this.history.push(result);
    this.patternCounts.set(
      result.code,
      (this.patternCounts.get(result.code) ?? 0) + 1
    );

    return result;
  }

  getTopFailures(limit = 10): Array<{ code: ErrorCode; count: number }> {
    return [...this.patternCounts.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([code, count]) => ({ code, count }));
  }

  getAlertsToEmit(): FailureAnalysisResult[] {
    return this.history.filter((r) => r.shouldAlert);
  }

  clearHistory(): void {
    this.history = [];
    this.patternCounts.clear();
  }

  get size(): number {
    return this.history.length;
  }
}
