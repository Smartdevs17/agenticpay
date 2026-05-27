// Transaction builder — Issue #329
//
// Bridges transaction signing with the MPC module. Standard-value transactions
// are signed with a single key (fast path); high-value transactions are routed
// through the M-of-N MPC coordinator, which only releases a signature once a
// threshold of nodes has approved. This removes the single-key signer as a
// single point of failure for the transactions that matter most.

import { getKey, startSigningSession } from './mpc/coordinator.js';

/** Default high-value cutoff (in the transaction's base unit). */
const DEFAULT_HIGH_VALUE_THRESHOLD = 10_000;

export type SigningMode = 'single' | 'mpc';

export interface TransactionSigningRequest {
  /** Transaction value used to decide the signing path. */
  amount: number;
  /** Bytes to sign (e.g. a Stellar transaction hash/envelope). */
  payload: Buffer;
  /** Identity of the caller initiating the signature, for audit. */
  requestedBy: string;
  /** MPC managed-key id; required for the high-value path. */
  keyId?: string;
  /** Single-key signer used for the standard path. */
  singleKeySign?: (payload: Buffer) => Promise<Buffer> | Buffer;
  /** Optional MPC signing-session timeout. */
  timeoutMs?: number;
}

export type TransactionSigningResult =
  | { mode: 'single'; signatureHex: string }
  | {
      mode: 'mpc';
      sessionId: string;
      status: 'pending_signatures';
      threshold: number;
      quorum: string[];
    };

export class TransactionBuilderService {
  constructor(private highValueThreshold: number = DEFAULT_HIGH_VALUE_THRESHOLD) {}

  setHighValueThreshold(threshold: number): void {
    if (threshold <= 0) {
      throw new Error('high-value threshold must be positive');
    }
    this.highValueThreshold = threshold;
  }

  getHighValueThreshold(): number {
    return this.highValueThreshold;
  }

  isHighValue(amount: number): boolean {
    return amount >= this.highValueThreshold;
  }

  classify(amount: number): SigningMode {
    return this.isHighValue(amount) ? 'mpc' : 'single';
  }

  /**
   * Sign a transaction via the appropriate path.
   *
   * - Standard value → signs immediately with `singleKeySign`.
   * - High value → opens an MPC threshold-signing session and returns it for
   *   the caller to drive the approval rounds (`coordinator.contribute`). The
   *   signature is only produced once the threshold is reached.
   */
  async signTransaction(request: TransactionSigningRequest): Promise<TransactionSigningResult> {
    if (this.isHighValue(request.amount)) {
      if (!request.keyId) {
        throw new Error('high-value transactions require an MPC keyId');
      }
      const key = getKey(request.keyId);
      if (!key) {
        throw new Error(`unknown MPC key ${request.keyId}`);
      }

      const session = startSigningSession({
        keyId: request.keyId,
        payload: request.payload,
        requestedBy: request.requestedBy,
        timeoutMs: request.timeoutMs,
      });

      return {
        mode: 'mpc',
        sessionId: session.id,
        status: 'pending_signatures',
        threshold: key.threshold,
        quorum: session.quorum,
      };
    }

    if (!request.singleKeySign) {
      throw new Error('singleKeySign is required for standard-value transactions');
    }
    const signature = await request.singleKeySign(request.payload);
    return { mode: 'single', signatureHex: signature.toString('hex') };
  }
}

export const transactionBuilderService = new TransactionBuilderService();
