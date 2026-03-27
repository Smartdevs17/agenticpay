import * as StellarSdk from '@stellar/stellar-sdk';

const NETWORK = process.env.STELLAR_NETWORK || 'testnet';
const HORIZON_URL =
  NETWORK === 'public'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

export const server = new StellarSdk.Horizon.Server(HORIZON_URL);

export class ValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = statusCode;
  }
}

export class InvalidStellarInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStellarInputError';
  }
}

export function isValidStellarAddress(address: string) {
  if (!address?.trim()) {
    return false;
  }

  return StellarSdk.StrKey.isValidEd25519PublicKey(address);
}

export function isValidTransactionHash(hash: string) {
  if (!hash?.trim()) {
    return false;
  }

  return /^[A-Fa-f0-9]{64}$/.test(hash);
}

function assertValidStellarAddress(address: string) {
  if (!isValidStellarAddress(address)) {
    throw new InvalidStellarInputError('Invalid Stellar address');
  }
}

function assertValidTransactionHash(hash: string) {
  if (!isValidTransactionHash(hash)) {
    throw new InvalidStellarInputError('Invalid transaction hash');
  }
}

export async function getAccountInfo(address: string) {
  assertValidStellarAddress(address);

  const account = await server.loadAccount(address);
  return {
    address: account.accountId(),
    balances: account.balances.map((b) => ({
      type: b.asset_type,
      balance: b.balance,
    })),
    sequence: account.sequence,
  };
}

export async function getTransactionStatus(hash: string) {
  assertValidTransactionHash(hash);

  const tx = await server.transactions().transaction(hash).call();
  return {
    hash: tx.hash,
    successful: tx.successful,
    ledger: tx.ledger_attr,
    createdAt: tx.created_at,
    memo: tx.memo,
    operationCount: tx.operation_count,
  };
}
