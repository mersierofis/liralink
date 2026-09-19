// The only place that imports decimal.js (enforced by eslint). Money is a decimal string at every
// boundary: parsed into a Decimal here, formatted back to a string here, never a JS number.
// Prisma's own Decimal is never used for arithmetic: values from the database are read through
// `toFixed()` (no exponent notation) and re-parsed, so the two classes never mix.
import { Decimal } from 'decimal.js';

/** Private Decimal with enough precision that no money operation here ever rounds implicitly. */
const D = Decimal.clone({ precision: 64, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -64, toExpPos: 64 });
type Dec = InstanceType<typeof D>;

export const TRY_DP = 2;
export const USDC_DP = 7;
/** Storage precision of an FX rate (Decimal(20,7)); the API returns rates with this many dp. */
export const RATE_DP = 7;
/** An anchor rate is rounded down to 6 dp (anchor.md, SEP-38). */
export const ANCHOR_RATE_DP = 6;

/** A plain, non-negative decimal: digits, optionally a dot and more digits. No sign, no exponent. */
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;
/** amountTRY as the API accepts it: exactly 2 dp (00-PROJECT.md §6). */
export const TRY_INPUT = /^\d+\.\d{2}$/;
export const MIN_LINK_TRY = '1.00';
export const MAX_LINK_TRY = '1000000.00';

/** A string, or a Prisma Decimal (anything with a lossless `toFixed()`). Never a number. */
export type MoneyLike = string | { toFixed(): string };

function parse(value: MoneyLike): Dec {
  const s = typeof value === 'string' ? value : value.toFixed();
  if (!PLAIN_DECIMAL.test(s)) throw new Error(`Not a plain decimal string: "${s}"`);
  return new D(s);
}

function format(value: MoneyLike, dp: number, what: string): string {
  const d = parse(value);
  if (d.decimalPlaces() > dp) throw new Error(`${what} has more than ${dp} dp: ${d.toFixed()}`);
  return d.toFixed(dp);
}

/** TRY as the API returns it: exactly 2 dp. Throws rather than silently rounding. */
export function formatTRY(value: MoneyLike): string {
  return format(value, TRY_DP, 'TRY amount');
}

/** USDC as the API returns it: exactly 7 dp, zero included ("0.0000000"). Throws rather than rounding. */
export function formatUSDC(value: MoneyLike): string {
  return format(value, USDC_DP, 'USDC amount');
}

/** An FX rate as the API returns it: RATE_DP dp. */
export function formatRate(value: MoneyLike): string {
  return format(value, RATE_DP, 'FX rate');
}

/** An FX spread (a fraction, not money) as the API returns it: 7 dp. */
export function formatSpread(value: MoneyLike): string {
  return format(value, USDC_DP, 'FX spread');
}

/** True when `amountTRY` is a valid link amount: exactly 2 dp, 1.00–1,000,000.00. */
export function isValidLinkAmountTRY(amountTRY: string): boolean {
  if (!TRY_INPUT.test(amountTRY)) return false;
  const d = parse(amountTRY);
  return d.gte(MIN_LINK_TRY) && d.lte(MAX_LINK_TRY);
}

/** True when `rate` is a plain decimal > 0 with at most RATE_DP dp. */
export function isValidRate(rate: string): boolean {
  if (!PLAIN_DECIMAL.test(rate)) return false;
  const d = parse(rate);
  return d.gt(0) && d.decimalPlaces() <= RATE_DP;
}

/** True when `value` is a plain decimal string > 0 (any number of dp). */
export function isPositiveDecimal(value: unknown): value is string {
  return typeof value === 'string' && PLAIN_DECIMAL.test(value) && parse(value).gt(0);
}

/** True when two plain decimal strings denote the same number ("1" and "1.0000000"). */
export function sameDecimal(a: string, b: string): boolean {
  return parse(a).eq(parse(b));
}

/**
 * 1 / price, rounded DOWN to `dp` decimal places. Turns a SEP-38 price (USDC per 1 TRY) into a
 * rate (TRY per 1 USDC). Rounding the rate down can only make quotedUSDC larger, never short.
 */
export function invertPriceDown(price: string, dp: number): string {
  if (parse(price).lte(0)) throw new Error('price must be > 0');
  const quotient = D.clone({ rounding: Decimal.ROUND_DOWN }).div(1, price);
  return quotient.toDecimalPlaces(dp, Decimal.ROUND_DOWN).toFixed(dp);
}

/** numerator / denominator, rounded half-up to `dp` decimal places. Not for amounts of money. */
export function ratio(numerator: string, denominator: string, dp: number): string {
  if (parse(denominator).lte(0)) throw new Error('denominator must be > 0');
  return parse(numerator).div(parse(denominator)).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp);
}

/**
 * quotedUSDC = amountTRY / rate, rounded UP to 7 dp so the payer never underpays (01-BACKEND.md).
 * The division itself rounds up at 64 significant digits, so a long quotient can only round
 * towards the ceiling, never below it: the result is exactly ceil(amountTRY / rate, 7 dp).
 */
export function quoteUSDC(amountTRY: string, rate: string): string {
  parse(amountTRY);
  if (parse(rate).lte(0)) throw new Error('FX rate must be > 0');
  const quotient = D.clone({ rounding: Decimal.ROUND_UP }).div(amountTRY, rate);
  return quotient.toDecimalPlaces(USDC_DP, Decimal.ROUND_UP).toFixed(USDC_DP);
}
