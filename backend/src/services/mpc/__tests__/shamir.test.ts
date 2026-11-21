import { describe, expect, it } from 'vitest';
import { __internals, reconstruct, split } from '../shamir.js';

describe('shamir', () => {
  it('reconstructs a 32-byte secret from exactly threshold shares', () => {
    const secret = Buffer.from(
      '0001020304050607' +
        '08090a0b0c0d0e0f' +
        '101112131415161718191a1b1c1d1e1f',
      'hex',
    );
    const shares = split(secret, 3, 5);
    expect(shares).toHaveLength(5);
    for (const share of shares) expect(share.y).toHaveLength(32);

    const recovered = reconstruct([shares[0], shares[2], shares[4]]);
    expect(recovered.equals(secret)).toBe(true);
  });

  it('reconstructs the same secret from any subset of threshold size', () => {
    const secret = Buffer.from('deadbeefcafebabe'.repeat(4), 'hex');
    const shares = split(secret, 4, 7);

    const subsets: number[][] = [
      [0, 1, 2, 3],
      [1, 2, 5, 6],
      [0, 3, 4, 6],
    ];
    for (const ix of subsets) {
      const subset = ix.map((i) => shares[i]);
      expect(reconstruct(subset).equals(secret)).toBe(true);
    }
  });

  it('tolerates an overlapping subset larger than threshold', () => {
    const secret = Buffer.from('a1b2c3d4e5f607080910111213141516', 'hex');
    const shares = split(secret, 3, 5);
    const recovered = reconstruct(shares);
    expect(recovered.equals(secret)).toBe(true);
  });

  it('below-threshold subset reveals no information (different shares do NOT reconstruct)', () => {
    const secret = Buffer.from('112233445566778899aabbccddeeff00', 'hex');
    const shares = split(secret, 3, 5);
    const twoShares = [shares[0], shares[1]];
    // Lagrange interpolation with only 2 points of a degree-2 polynomial
    // yields a valid-but-wrong value — the point is that it does not
    // equal the secret with overwhelming probability.
    const wrong = reconstruct([...twoShares, { x: 99, y: Buffer.alloc(16) }]);
    expect(wrong.equals(secret)).toBe(false);
  });

  it('rejects invalid parameters', () => {
    expect(() => split(Buffer.alloc(0), 2, 3)).toThrow(/non-empty/);
    expect(() => split(Buffer.from('aa', 'hex'), 1, 3)).toThrow(/threshold/);
    expect(() => split(Buffer.from('aa', 'hex'), 3, 2)).toThrow(/totalShares/);
    expect(() => split(Buffer.from('aa', 'hex'), 2, 300)).toThrow(/254/);
  });

  it('rejects reconstruct inputs with duplicate or zero x-coords', () => {
    const secret = Buffer.from('00112233', 'hex');
    const shares = split(secret, 2, 3);

    expect(() => reconstruct([shares[0], shares[0]])).toThrow(/unique/);
    expect(() =>
      reconstruct([
        shares[0],
        { x: 0, y: Buffer.alloc(secret.length) },
      ]),
    ).toThrow(/non-zero/);
    expect(() =>
      reconstruct([shares[0], { x: 2, y: Buffer.alloc(secret.length - 1) }]),
    ).toThrow(/matching byte length/);
  });

  it('GF(256) arithmetic satisfies field properties', () => {
    const { mul, div } = __internals;
    // Identity, inverse, and distributivity on a handful of values.
    expect(mul(5, 1)).toBe(5);
    expect(mul(0, 123)).toBe(0);
    expect(div(7, 7)).toBe(1);

    for (let a = 1; a < 16; a++) {
      for (let b = 1; b < 16; b++) {
        const c = mul(a, b);
        expect(div(c, b)).toBe(a);
      }
    }
    expect(() => div(5, 0)).toThrow(/zero/);
  });
});
