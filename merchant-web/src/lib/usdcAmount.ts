import { Decimal } from 'decimal.js'

/** A plain decimal with at most 7 fraction digits — no exponent, no separators. */
export const USDC_AMOUNT_REGEX = /^\d+(\.\d{1,7})?$/

/** A Stellar public key: "G" + 55 base32 chars (56 total). */
export const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/

/** Exactly 7 dp, as the API expects — via Decimal, never Number(). Call only after the regex passes. */
export function formatToUsdcAmount(value: string): string {
  return new Decimal(value).toFixed(7)
}
