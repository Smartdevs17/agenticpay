import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../config/env.js';
import { validateAuthorizationToken } from './signature.js';
import { isNonceUsed, markNonceUsed } from './nonce.js';
import { checkRelayRateLimit } from './rateLimit.js';
import { estimateGas } from './health.js';
import type { RelayRequest, RelayResult } from './types.js';

const NETWORK = config().STELLAR_NETWORK;
const NETWORK_PASSPHRASE =
  NETWORK === 'public' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
const HORIZON_URL =
  NETWORK === 'public'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

const server = new StellarSdk.Horizon.Server(HORIZON_URL);

export class RelayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

/**
 * Submits a gasless transaction on behalf of a user.
 * The relayer signs and pays the fee; the user's authorization token
 * proves consent for the specific operation.
 *
 * Falls back gracefully: if RELAYER_SECRET_KEY is not configured,
 * returns instructions for user-initiated submission.
 */
export async function relayTransaction(request: RelayRequest): Promise<RelayResult> {
  const { token } = request;

  // 1. Rate limit check
  const rateLimit = checkRelayRateLimit(token.message.from);
  if (!rateLimit.allowed) {
    throw new RelayError(
      `Rate limit exceeded. Retry in ${rateLimit.resetInSeconds}s`,
      'RATE_LIMIT_EXCEEDED',
      429
    );
  }

  // 2. Validate signature and expiry
  const validation = validateAuthorizationToken(token);
  if (!validation.valid) {
    throw new RelayError(validation.reason ?? 'Invalid authorization token', 'INVALID_TOKEN');
  }

  // 3. Replay protection
  if (isNonceUsed(token.message.from, token.message.nonce)) {
    throw new RelayError('Nonce already used (replay detected)', 'NONCE_REPLAY');
  }

  // 4. Check relayer key is configured
  const relayerSecret = process.env.RELAYER_SECRET_KEY;
  if (!relayerSecret) {
    // Fallback: user must submit themselves
    throw new RelayError(
      'Relayer not configured. Submit transaction directly.',
      'RELAYER_UNAVAILABLE',
      503
    );
  }

  // 5. Build and submit the transaction
  const relayerKeypair = StellarSdk.Keypair.fromSecret(relayerSecret);
  const estimate = estimateGas();
  const feeStoops = Math.round(parseFloat(estimate.totalFee) * 10_000_000);

  const relayerAccount = await server.loadAccount(relayerKeypair.publicKey());

  // Decode the operation from base64 XDR or treat as a payment memo
  let operation: StellarSdk.xdr.Operation;
  try {
    const opXdr = Buffer.from(token.message.operation, 'base64');
    operation = StellarSdk.xdr.Operation.fromXDR(opXdr);
  } catch {
    // Fallback: create a minimal payment operation to the destination
    operation = StellarSdk.Operation.payment({
      destination: token.message.to,
      asset: StellarSdk.Asset.native(),
      amount: '0.0000001',
      source: token.message.from,
    });
  }

  const tx = new StellarSdk.TransactionBuilder(relayerAccount, {
    fee: String(feeStoops),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  tx.sign(relayerKeypair);

  // Mark nonce used before submission to prevent concurrent replays
  markNonceUsed(token.message.from, token.message.nonce);

  const result = await server.submitTransaction(tx);

  return {
    transactionHash: result.hash,
    fee: estimate.totalFee,
    ledger: (result as any).ledger,
  };
}
