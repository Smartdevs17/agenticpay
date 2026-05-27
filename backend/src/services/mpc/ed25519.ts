/**
 * Thin Ed25519 wrappers around Node's built-in `crypto`. Centralising
 * them here keeps the rest of the MPC code free of key-format noise
 * (PKCS#8 wrappers, DER prefixes, etc.).
 *
 * Ed25519 keys have a 32-byte seed; Node only exports them as PKCS#8
 * DER blobs, so we use the fact that the seed is always the *last* 32
 * bytes of the PKCS#8 private-key DER and a known 16-byte prefix
 * reverses the transformation.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';

const ED25519_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export const SEED_BYTES = 32;
export const PUBLIC_KEY_BYTES = 32;
export const SIGNATURE_BYTES = 64;

/** Generate a fresh 32-byte Ed25519 seed using the OS CSPRNG. */
export function generateSeed(): Buffer {
  // `randomBytes` is CSPRNG-backed; this is equivalent to deriving a seed
  // from `generateKeyPairSync('ed25519')` but avoids the DER round trip.
  return randomBytes(SEED_BYTES);
}

/** Derive the Ed25519 public key (32 bytes) for a given seed. */
export function publicKeyFromSeed(seed: Buffer): Buffer {
  assertSeed(seed);
  const privateKey = privateKeyFromSeed(seed);
  const spki = createPublicKey(privateKey).export({
    format: 'der',
    type: 'spki',
  });
  return Buffer.from(spki.subarray(spki.length - PUBLIC_KEY_BYTES));
}

/** Turn a raw 32-byte seed into a Node `KeyObject` usable with `crypto.sign`. */
export function privateKeyFromSeed(seed: Buffer): KeyObject {
  assertSeed(seed);
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/** Turn a raw 32-byte public key into a verifying `KeyObject`. */
export function publicKeyFromBytes(publicKey: Buffer): KeyObject {
  if (publicKey.length !== PUBLIC_KEY_BYTES) {
    throw new Error(`public key must be ${PUBLIC_KEY_BYTES} bytes`);
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, publicKey]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/** Sign `message` with the seed; returns the 64-byte Ed25519 signature. */
export function sign(seed: Buffer, message: Buffer): Buffer {
  const privateKey = privateKeyFromSeed(seed);
  // Ed25519 is a "pure" signature scheme — pass `null` as the hash alg.
  return cryptoSign(null, message, privateKey);
}

/** Verify an Ed25519 signature. Returns true on success. */
export function verify(publicKey: Buffer, message: Buffer, signature: Buffer): boolean {
  if (signature.length !== SIGNATURE_BYTES) return false;
  const keyObj = publicKeyFromBytes(publicKey);
  return cryptoVerify(null, message, keyObj, signature);
}

export function generateIdentityKeypair(): { seed: Buffer; publicKey: Buffer } {
  // Go through `generateKeyPairSync` here to explicitly exercise Node's
  // key-generation path for the identity keys the MPC nodes use to sign
  // approvals. We then extract the raw seed for ergonomic storage.
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    seed: Buffer.from(pkcs8.subarray(pkcs8.length - SEED_BYTES)),
    publicKey: Buffer.from(spki.subarray(spki.length - PUBLIC_KEY_BYTES)),
  };
}

/** Best-effort secret-zeroisation. JS buffers aren't guaranteed to be
 *  wiped from memory, but this still reduces the window during which a
 *  reconstructed seed lingers. */
export function wipe(buffer: Buffer): void {
  buffer.fill(0);
}

function assertSeed(seed: Buffer): void {
  if (seed.length !== SEED_BYTES) {
    throw new Error(`seed must be exactly ${SEED_BYTES} bytes`);
  }
}
