import * as StellarSdk from '@stellar/stellar-sdk';
import { createHash } from 'node:crypto';
import type { AuthorizationDomain, AuthorizationMessage, AuthorizationToken } from './types.js';

// Stellar network passphrases
const NETWORK_PASSPHRASES: Record<string, string> = {
  testnet: StellarSdk.Networks.TESTNET,
  public: StellarSdk.Networks.PUBLIC,
};

/**
 * Builds a deterministic hash of the authorization payload (domain + message).
 * Analogous to EIP-712 typed structured data hashing, adapted for Stellar/Ed25519.
 */
export function buildAuthorizationHash(
  domain: AuthorizationDomain,
  message: AuthorizationMessage
): Buffer {
  const networkPassphrase = NETWORK_PASSPHRASES[domain.networkPassphrase] ?? domain.networkPassphrase;

  // Domain separator
  const domainStr = [
    domain.name,
    domain.version,
    networkPassphrase,
    domain.contractId,
  ].join(':');

  // Message payload
  const messageStr = [
    message.from,
    message.to,
    String(message.nonce),
    String(message.validUntil),
    message.operation,
    message.maxFee,
  ].join(':');

  const payload = `${domainStr}\n${messageStr}`;
  return createHash('sha256').update(payload, 'utf8').digest();
}

/**
 * Validates an off-chain authorization token:
 * 1. Checks expiry
 * 2. Verifies Ed25519 signature against the structured hash
 */
export function validateAuthorizationToken(token: AuthorizationToken): {
  valid: boolean;
  reason?: string;
} {
  const { domain, message, signature } = token;

  // 1. Expiry check
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (message.validUntil < nowSeconds) {
    return { valid: false, reason: 'Authorization token has expired' };
  }

  // 2. Validate signer public key format
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(message.from)) {
    return { valid: false, reason: 'Invalid signer public key' };
  }

  // 3. Validate relayer/contract address
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(message.to)) {
    return { valid: false, reason: 'Invalid destination address' };
  }

  // 4. Verify Ed25519 signature
  try {
    const hash = buildAuthorizationHash(domain, message);
    const sigBytes = Buffer.from(signature, 'hex');
    const keyPair = StellarSdk.Keypair.fromPublicKey(message.from);
    const isValid = keyPair.verify(hash, sigBytes);
    if (!isValid) {
      return { valid: false, reason: 'Invalid signature' };
    }
  } catch {
    return { valid: false, reason: 'Signature verification failed' };
  }

  return { valid: true };
}
