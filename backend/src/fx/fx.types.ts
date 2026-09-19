import type { FxSource } from '../contract/api.types';

/** One USDC/TRY rate, with what a receipt needs to show what was quoted and when. */
export interface FxQuote {
  /** TRY per 1 USDC that a link is priced at: the spread is already in it. Decimal string. */
  rate: string;
  /** TRY per 1 USDC before the spread. Decimal string. */
  midRate: string;
  /**
   * Share of each USDC the rate source keeps as its spread, e.g. "0.0050237" (≈ 50 bps).
   * "0" for mock; null when the source did not state its fee in USDC.
   */
  spread: string | null;
  source: FxSource;
  /** When the rate was obtained from its source. */
  fetchedAt: Date;
  /** The source's response body, verbatim, kept on the link for audit. null for mock. */
  raw: unknown;
}

export interface FxProvider {
  getRate(): Promise<FxQuote>;
}

/**
 * No usable rate right now. Callers must fail the request: never fall back to a stale or
 * guessed rate. The message says what went wrong and is safe to return to the merchant.
 */
export class FxUnavailableError extends Error {
  override readonly name = 'FxUnavailableError';
}
