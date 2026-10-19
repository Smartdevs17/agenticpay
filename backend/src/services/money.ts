/**
 * Decimal-safe money arithmetic.
 *
 * Financial amounts must never be derived with binary floating point: `0.1 + 0.2`
 * is `0.30000000000000004`, and multiplying a fiat amount by an FX rate accumulates
 * the same error. Every helper here parses a decimal into integer minor units
 * (`bigint`), does the arithmetic there, and formats the result back to a fixed
 * number of decimal places. Rounding is half-away-from-zero, matching the
 * convention used by card networks for settlement.
 */

export class InvalidAmountError extends Error {
  readonly code = 'INVALID_AMOUNT';

  constructor(value: unknown) {
    super(`INVALID_AMOUNT: ${String(value)} is not a valid decimal amount`);
    this.name = 'InvalidAmountError';
  }
}

/** Number of decimal places used for intermediate FX rates before they are applied. */
export const RATE_DECIMALS = 12;

/** Minor-unit decimals for ISO-4217 fiat currencies handled by this service. */
export const FIAT_DECIMALS = 2;

/** Minor-unit decimals for the stablecoins and assets this service converts into. */
export const CRYPTO_DECIMALS = 7;

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/** Guards `10n ** BigInt(shift)` against absurd exponents such as `1e100000`. */
const MAX_SCALE_SHIFT = 120;

/** Rejects `NaN`, `Infinity`, `-Infinity` and anything else that cannot be a money amount. */
export function isValidAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertDecimals(decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new InvalidAmountError(decimals);
  }
  return decimals;
}

/** Rounds a non-negative bigint quotient to nearest, ties away from zero. */
function divRoundHalfUp(numerator: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) throw new InvalidAmountError(divisor);
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / divisor;
  const remainder = abs % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Parses a decimal string (or number) into integer minor units.
 *
 * `parseDecimalToMinor('10.005', 2) === 1001n` and `parseDecimalToMinor('-0.1', 2) === -10n`.
 * Scientific notation is supported so `String(1e-7)` round-trips correctly.
 */
export function parseDecimalToMinor(value: string | number, decimals: number): bigint {
  assertDecimals(decimals);

  let text: string;
  if (typeof value === 'number') {
    text = Number.isFinite(value) ? String(value) : '';
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    text = '';
  }

  const match = DECIMAL_PATTERN.exec(text);
  if (!match) throw new InvalidAmountError(value);

  const [, sign, integerPart, fractionPart = '', exponentPart] = match;
  if (!integerPart && !fractionPart) throw new InvalidAmountError(value);

  const digits = `${integerPart}${fractionPart}`.replace(/^0+(?=\d)/, '');
  const scale = fractionPart.length - Number(exponentPart ?? '0');
  const unsigned = BigInt(digits === '' ? '0' : digits);

  let minor: bigint;
  const shift = decimals - scale;
  if (shift > MAX_SCALE_SHIFT || shift < -MAX_SCALE_SHIFT) throw new InvalidAmountError(value);

  if (shift >= 0) {
    minor = unsigned * 10n ** BigInt(shift);
  } else {
    minor = divRoundHalfUp(unsigned, 10n ** BigInt(-shift));
  }

  return sign === '-' ? -minor : minor;
}

/** Renders minor units as a fixed-point decimal string, e.g. `formatMinor(1001n, 2) === '10.01'`. */
export function formatMinor(minor: bigint, decimals: number): string {
  assertDecimals(decimals);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;

  if (decimals === 0) return `${negative ? '-' : ''}${abs}`;

  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function addMinor(a: bigint, b: bigint): bigint {
  return a + b;
}

/** Lossy on purpose: for APIs whose public shape is `number`. Use `formatMinor` when the value is persisted. */
export function fromMinorToNumber(minor: bigint, decimals: number): number {
  return Number(formatMinor(minor, decimals));
}

/** Returns -1, 0 or 1 for `a < b`, `a === b`, `a > b`. */
export function compareMinor(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Applies an FX rate to an amount expressed in minor units, returning minor units
 * of the same scale. The rate itself is quantised to {@link RATE_DECIMALS} first so
 * the multiplication stays exact.
 */
export function multiplyByRate(amountMinor: bigint, rate: number, decimals: number): bigint {
  assertDecimals(decimals);
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
    throw new InvalidAmountError(rate);
  }
  if (amountMinor === 0n) return 0n;

  const rateMinor = parseDecimalToMinor(rate, RATE_DECIMALS);
  return divRoundHalfUp(amountMinor * rateMinor, 10n ** BigInt(RATE_DECIMALS));
}

/**
 * Normalises a number to a fixed number of decimal places without accumulating
 * binary floating point error. Used where the public API is typed as `number`.
 */
export function quantizeNumber(value: number, decimals: number): number {
  if (!isValidAmount(value)) throw new InvalidAmountError(value);
  return Number(formatMinor(parseDecimalToMinor(value, decimals), decimals));
}

/** Sums decimal amounts without floating point drift. */
export function sumAmounts(values: readonly (string | number)[], decimals: number): string {
  const total = values.reduce<bigint>(
    (running, value) => running + parseDecimalToMinor(value, decimals),
    0n,
  );
  return formatMinor(total, decimals);
}