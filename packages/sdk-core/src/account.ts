/**
 * packages/sdk-core/src/account.ts
 *
 * Account loading and balance extraction helpers.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { assertValidStellarAddress } from './address.js';
import type { StellarAccountInfo, StellarAccountBalance } from './types.js';

export async function loadAccount(
  server: StellarSdk.Horizon.Server,
  address: string
): Promise<StellarSdk.Horizon.AccountResponse> {
  assertValidStellarAddress(address);
  return server.loadAccount(address);
}

export function extractAccountBalances(
  account: StellarSdk.Horizon.AccountResponse
): StellarAccountBalance[] {
  return account.balances.map((b: any) => ({
    type: b.asset_type,
    balance: b.balance,
    assetCode: b.asset_code,
    assetIssuer: b.asset_issuer,
  }));
}

export function formatAccountInfo(
  account: StellarSdk.Horizon.AccountResponse
): StellarAccountInfo {
  return {
    address: account.accountId(),
    balances: extractAccountBalances(account),
    sequence: account.sequence,
  };
}
