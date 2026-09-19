import type { SettleFailReason } from '../contract/api.types';
import { floorTRY, formatUSDC, isUSDCAmount, mulDivDown, subtractUSDC, compareDecimal } from '../common/money';

/**
 * How a paid link is split (01-BACKEND.md, Settlement). The gross TRY is always the LINK's
 * amountTRY — what the merchant is owed — never received USDC × any rate.
 * - savedUSDC  = quotedUSDC × autoSave%        (kept in USDC), rounded down to the stroop
 * - amountUSDC = quotedUSDC − savedUSDC        (sent to the anchor): gets any rounding remainder
 * - amountTRY  = link.amountTRY × (100 − autoSave)%, rounded down to the kuruş
 * The overpaid excess, if any, is not here: it went to unallocatedUSDC when the payment landed.
 */
export function splitForSettlement(
  link: { amountTRY: string; quotedUSDC: string },
  autoSavePercent: number,
): { amountTRY: string; savedUSDC: string; amountUSDC: string } {
  if (!Number.isInteger(autoSavePercent) || autoSavePercent < 0 || autoSavePercent > 50) {
    throw new Error(`autoSavePercent out of range: ${autoSavePercent}`);
  }
  const savedUSDC = mulDivDown(link.quotedUSDC, String(autoSavePercent), '100', 7);
  return {
    amountTRY: mulDivDown(link.amountTRY, String(100 - autoSavePercent), '100', 2),
    savedUSDC,
    amountUSDC: subtractUSDC(link.quotedUSDC, savedUSDC),
  };
}

/** What the anchor reported when the withdrawal completed. */
export interface AnchorCompletion {
  /** TRY the anchor actually paid out (amount_out in iso4217:TRY), if it said so. */
  amountOutTRY: string | null;
  /** The anchor's fee in OUR USDC, if it booked the fee in USDC. */
  feeUSDC: string | null;
}

export type Booked = { feeUSDC: string; netTRY: string } | { failReason: SettleFailReason };

/**
 * anchor.md, "How the money is booked":
 * - The anchor reports the lira it paid (amount_out, TRY): netTRY = amount_out (to the kuruş), and
 *   feeUSDC = "0.0000000" — its fee is already inside amount_out; counting it again nets it twice.
 * - Otherwise a fee in our USDC: netTRY = amountTRY × (amountUSDC − fee) / amountUSDC, rounded
 *   down; a fee below 0 or above amountUSDC → invalid_fee.
 * - Neither → unexpected_fee_asset. Never a guess.
 */
export function bookCompletion(s: { amountTRY: string; amountUSDC: string }, c: AnchorCompletion): Booked {
  if (c.amountOutTRY !== null) return { feeUSDC: '0.0000000', netTRY: floorTRY(c.amountOutTRY) };
  if (c.feeUSDC !== null) {
    if (!isUSDCAmount(c.feeUSDC) || compareDecimal(c.feeUSDC, s.amountUSDC) > 0) return { failReason: 'invalid_fee' };
    const net = subtractUSDC(s.amountUSDC, c.feeUSDC);
    return { feeUSDC: formatUSDC(c.feeUSDC), netTRY: mulDivDown(s.amountTRY, net, s.amountUSDC, 2) };
  }
  return { failReason: 'unexpected_fee_asset' };
}
