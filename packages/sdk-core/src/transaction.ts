/**
 * packages/sdk-core/src/transaction.ts
 *
 * Transaction building, fee estimation, and Horizon/Soroban error translation.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { assertValidStellarAddress } from './address.js';
import type { StellarErrorTranslation } from './types.js';

export const BASE_FEE_STROOPS = 100;

export function estimateFee(baseFee = BASE_FEE_STROOPS, operations = 1): number {
  return Math.max(baseFee, BASE_FEE_STROOPS) * Math.max(operations, 1);
}

export function computeReplacementFee(currentFee: number, multiplier = 1.2): number {
  return Math.ceil(currentFee * multiplier);
}

export function isTransactionStuck(submittedAt: number, timeoutMs = 60_000): boolean {
  return Date.now() - submittedAt > timeoutMs;
}

export interface BuildPaymentOptions {
  destination: string;
  amount: string;
  asset?: StellarSdk.Asset;
  memo?: string;
  fee?: number;
  networkPassphrase?: string;
}

export function buildPaymentTransaction(
  sourceAccount: StellarSdk.Account,
  options: BuildPaymentOptions
): StellarSdk.Transaction {
  assertValidStellarAddress(options.destination);

  const asset = options.asset ?? StellarSdk.Asset.native();
  const fee = options.fee ? String(options.fee) : String(BASE_FEE_STROOPS);
  const networkPassphrase = options.networkPassphrase ?? StellarSdk.Networks.TESTNET;

  const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase,
  }).addOperation(
    StellarSdk.Operation.payment({
      destination: options.destination,
      asset,
      amount: options.amount,
    })
  ).setTimeout(30);

  if (options.memo) {
    builder.addMemo(StellarSdk.Memo.text(options.memo));
  }

  return builder.build();
}

/**
 * Translates Horizon and Soroban errors into structured machine-readable error descriptors.
 */
export function translateStellarError(error: unknown): StellarErrorTranslation {
  if (!error || typeof error !== 'object') {
    return {
      code: 'ERR_BLOCKCHAIN_TRANSACTION_FAILED',
      message: 'Unknown blockchain error occurred',
      status: 502,
    };
  }

  const err = error as any;
  const horizonResponse = err.response?.data;

  if (horizonResponse) {
    const status = horizonResponse.status || err.response?.status || 502;
    const title = horizonResponse.title || 'Stellar Horizon error';
    const detail = horizonResponse.detail || err.message || 'Operation failed on Stellar network';
    const extras = horizonResponse.extras;

    let code = 'ERR_BLOCKCHAIN_TRANSACTION_FAILED';
    if (status === 404) {
      code = 'ERR_RESOURCE_NOT_FOUND';
    } else if (extras?.result_codes?.transaction === 'tx_insufficient_balance') {
      code = 'ERR_PAYMENT_INSUFFICIENT_FUNDS';
    } else if (extras?.result_codes?.transaction === 'tx_bad_auth') {
      code = 'ERR_AUTH_FORBIDDEN';
    }

    return {
      code,
      message: `${title}: ${detail}`,
      status: status >= 400 && status < 600 ? status : 502,
      details: extras,
    };
  }

  return {
    code: 'ERR_BLOCKCHAIN_TRANSACTION_FAILED',
    message: err.message || 'Stellar operation failed',
    status: 502,
    details: err.stack ? undefined : err,
  };
}
