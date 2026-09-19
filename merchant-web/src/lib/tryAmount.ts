import { Decimal } from 'decimal.js'

/**
 * A plain decimal string with at most 2 fraction digits — no scientific notation ("1e3"), no
 * thousands separators, no leading "+"/"-". Matches what the backend accepts for amountTRY
 * (04-BACKEND-HANDOFF.md gotcha #3: `POST /links` requires exactly `^\d+\.\d{2}$`; this is the
 * looser "still typing" version used for form validation before formatToTRY pads it to 2dp).
 */
export const TRY_AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/

export function isPlainTRYAmount(value: string): boolean {
  return TRY_AMOUNT_REGEX.test(value)
}

/** Parses a pre-validated (isPlainTRYAmount) string. Never call on unvalidated user input —
 * Decimal doesn't reject "1e3" either, it's the regex's job to keep exponential notation out. */
export function parseTRYAmount(value: string): Decimal {
  return new Decimal(value)
}

/** Formats to exactly 2dp for POST /links / POST /withdrawals — never via `Number(v).toFixed(2)`,
 * which silently rounds through a float (e.g. "100.005" -> "100.00" or "100.01" depending on the
 * platform's float rounding, not the decimal one an accounting value needs). */
export function formatToTRYAmount(value: string): string {
  return parseTRYAmount(value).toFixed(2)
}
