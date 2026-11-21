/**
 * In-memory nonce store for replay protection.
 * Tracks used nonces per signer address with TTL cleanup.
 */

interface NonceEntry {
  usedAt: number; // ms timestamp
}

// nonce store: signerAddress -> Set of used nonces
const nonceStore = new Map<string, Map<number, NonceEntry>>();

// Clean up nonces older than this (must exceed max token validity window)
const NONCE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function isNonceUsed(signerAddress: string, nonce: number): boolean {
  return nonceStore.get(signerAddress)?.has(nonce) ?? false;
}

export function markNonceUsed(signerAddress: string, nonce: number): void {
  if (!nonceStore.has(signerAddress)) {
    nonceStore.set(signerAddress, new Map());
  }
  nonceStore.get(signerAddress)!.set(nonce, { usedAt: Date.now() });
}

/** Purge expired nonce entries (call periodically). */
export function pruneExpiredNonces(): void {
  const cutoff = Date.now() - NONCE_TTL_MS;
  for (const [address, nonces] of nonceStore) {
    for (const [nonce, entry] of nonces) {
      if (entry.usedAt < cutoff) nonces.delete(nonce);
    }
    if (nonces.size === 0) nonceStore.delete(address);
  }
}
