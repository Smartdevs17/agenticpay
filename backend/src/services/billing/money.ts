/** Round a monetary value, avoiding binary floating point drift (1.005 → 1.01). */
export function roundMoney(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
