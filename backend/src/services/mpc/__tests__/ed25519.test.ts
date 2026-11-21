import { describe, expect, it } from 'vitest';
import {
  PUBLIC_KEY_BYTES,
  SEED_BYTES,
  SIGNATURE_BYTES,
  generateIdentityKeypair,
  generateSeed,
  publicKeyFromSeed,
  sign,
  verify,
  wipe,
} from '../ed25519.js';

describe('ed25519 helpers', () => {
  it('generates 32-byte seeds and derives matching public keys', () => {
    const seed = generateSeed();
    expect(seed).toHaveLength(SEED_BYTES);

    const pub = publicKeyFromSeed(seed);
    expect(pub).toHaveLength(PUBLIC_KEY_BYTES);

    // Deterministic: same seed → same public key.
    expect(publicKeyFromSeed(seed).equals(pub)).toBe(true);
  });

  it('signs and verifies with the derived key pair', () => {
    const seed = generateSeed();
    const pub = publicKeyFromSeed(seed);
    const message = Buffer.from('hello AgenticPay', 'utf-8');

    const signature = sign(seed, message);
    expect(signature).toHaveLength(SIGNATURE_BYTES);
    expect(verify(pub, message, signature)).toBe(true);
  });

  it('rejects tampered messages and mismatched keys', () => {
    const seed = generateSeed();
    const pub = publicKeyFromSeed(seed);
    const message = Buffer.from('payment payload');
    const signature = sign(seed, message);

    const tampered = Buffer.from('payment Payload');
    expect(verify(pub, tampered, signature)).toBe(false);

    const otherPub = publicKeyFromSeed(generateSeed());
    expect(verify(otherPub, message, signature)).toBe(false);

    expect(verify(pub, message, signature.subarray(0, 32))).toBe(false);
  });

  it('generates independent identity keypairs', () => {
    const a = generateIdentityKeypair();
    const b = generateIdentityKeypair();
    expect(a.seed.equals(b.seed)).toBe(false);
    expect(a.publicKey.equals(b.publicKey)).toBe(false);
    // The derived public key matches what we'd compute from the seed.
    expect(publicKeyFromSeed(a.seed).equals(a.publicKey)).toBe(true);
  });

  it('wipe zeroes out buffers in place', () => {
    const buf = Buffer.from('ff'.repeat(32), 'hex');
    wipe(buf);
    expect(buf.every((byte) => byte === 0)).toBe(true);
  });

  it('rejects malformed inputs', () => {
    expect(() => publicKeyFromSeed(Buffer.alloc(31))).toThrow(/32 bytes/);
    expect(() => sign(Buffer.alloc(31), Buffer.from('x'))).toThrow(/32 bytes/);
    expect(() =>
      verify(Buffer.alloc(31), Buffer.from('x'), Buffer.alloc(SIGNATURE_BYTES)),
    ).toThrow(/32 bytes/);
  });
});
