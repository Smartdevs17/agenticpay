/**
 * Shamir Secret Sharing over GF(2^8).
 *
 * Secrets (byte strings) are split into `totalShares` shares of which any
 * `threshold` are enough to reconstruct the original. Below `threshold`
 * shares reveal no information about the secret.
 *
 * We run SSS byte-by-byte over GF(256) using the AES polynomial
 * (0x11B) — standard, fast, deterministic, and free of dependencies.
 *
 * This module is purely arithmetic — it has no concept of nodes,
 * storage, or HSM. The coordinator layer on top decides where shares go
 * and when they are reconstructed.
 */
import { randomBytes } from 'node:crypto';
import type { Share } from './types.js';

const FIELD_SIZE = 256;

// Precomputed exp/log tables for GF(256) with the AES polynomial 0x11B
// and generator 0x03. Built once at module load — the tables are cheap
// (256 bytes each) and let us do constant-time multiplication/inverse.
const EXP = new Uint8Array(FIELD_SIZE * 2);
const LOG = new Uint8Array(FIELD_SIZE);

(function buildTables(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // Multiply by 0x03 in GF(256): x * 3 = x + (x << 1), then reduce
    // modulo the AES polynomial 0x11B when the high bit was set.
    let next = x ^ ((x << 1) & 0xff);
    if (x & 0x80) next ^= 0x1b;
    x = next & 0xff;
  }
  // Double the exp table so we can index without modulo on lookups.
  for (let i = 255; i < 510; i++) EXP[i] = EXP[i - 255];
  LOG[0] = 0;
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function div(a: number, b: number): number {
  if (b === 0) throw new Error('division by zero in GF(256)');
  if (a === 0) return 0;
  return EXP[LOG[a] + 255 - LOG[b]];
}

/** Evaluate a polynomial whose coefficients are (a0, a1, ..., a_{t-1}) at x. */
function evaluate(coeffs: number[], x: number): number {
  // Horner's method — fewer multiplications than naive Σ a_i * x^i.
  let y = coeffs[coeffs.length - 1];
  for (let i = coeffs.length - 2; i >= 0; i--) {
    y = mul(y, x) ^ coeffs[i];
  }
  return y;
}

/**
 * Reconstruct the constant term of a polynomial from a set of (x,y)
 * points using Lagrange interpolation at x = 0.
 */
function interpolateAtZero(points: Array<{ x: number; y: number }>): number {
  let result = 0;
  for (let i = 0; i < points.length; i++) {
    let numerator = 1;
    let denominator = 1;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      // Lagrange basis: Π (0 - x_j) / (x_i - x_j). In GF(256),
      // subtraction is XOR, so (0 - x_j) === x_j and (x_i - x_j) === x_i ^ x_j.
      numerator = mul(numerator, points[j].x);
      denominator = mul(denominator, points[i].x ^ points[j].x);
    }
    result ^= mul(points[i].y, div(numerator, denominator));
  }
  return result;
}

export function split(secret: Buffer, threshold: number, totalShares: number): Share[] {
  if (secret.length === 0) throw new Error('secret must be non-empty');
  if (threshold < 2) throw new Error('threshold must be at least 2');
  if (totalShares < threshold) {
    throw new Error('totalShares must be >= threshold');
  }
  if (totalShares > 254) {
    // We reserve x=0 (constant term = secret) and x=255 is technically
    // usable but we keep the upper bound friendly.
    throw new Error('totalShares must be <= 254');
  }

  // One polynomial per secret byte; share y is the concatenation of each
  // polynomial's evaluation at the share's x coordinate.
  const shares: Share[] = [];
  for (let x = 1; x <= totalShares; x++) {
    shares.push({ x, y: Buffer.alloc(secret.length) });
  }

  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    const coeffs = new Array<number>(threshold);
    coeffs[0] = secret[byteIdx];
    const random = randomBytes(threshold - 1);
    for (let i = 1; i < threshold; i++) coeffs[i] = random[i - 1];

    for (const share of shares) {
      share.y[byteIdx] = evaluate(coeffs, share.x);
    }
  }

  return shares;
}

export function reconstruct(shares: Share[]): Buffer {
  if (shares.length < 2) throw new Error('need at least 2 shares');
  const secretLength = shares[0].y.length;
  for (const share of shares) {
    if (share.y.length !== secretLength) {
      throw new Error('all shares must have matching byte length');
    }
    if (share.x === 0) {
      throw new Error('share x-coordinate must be non-zero');
    }
  }

  const xs = shares.map((s) => s.x);
  if (new Set(xs).size !== xs.length) {
    throw new Error('share x-coordinates must be unique');
  }

  const secret = Buffer.alloc(secretLength);
  for (let byteIdx = 0; byteIdx < secretLength; byteIdx++) {
    const points = shares.map((s) => ({ x: s.x, y: s.y[byteIdx] }));
    secret[byteIdx] = interpolateAtZero(points);
  }
  return secret;
}

/** For tests: expose the low-level arithmetic so coverage can exercise it. */
export const __internals = { mul, div, evaluate, interpolateAtZero };
