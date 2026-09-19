import type { Settlement } from '../contract/api.types';
import type { Settlement as SettlementRow } from '../generated/prisma/client';
import { formatRate, formatTRY, formatUSDC } from '../common/money';

/** The contract Settlement. Internal state (blockedReason, anchor memo, payment XDR, …) never leaves. */
export function toSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    merchantId: row.merchantId,
    paymentId: row.paymentId,
    amountUSDC: formatUSDC(row.amountUSDC),
    amountTRY: formatTRY(row.amountTRY),
    fxRate: formatRate(row.fxRate),
    savedUSDC: formatUSDC(row.savedUSDC),
    feeUSDC: row.feeUSDC === null ? null : formatUSDC(row.feeUSDC),
    netTRY: row.netTRY === null ? null : formatTRY(row.netTRY),
    provider: row.provider,
    status: row.status,
    ...(row.anchorRef !== null && { anchorRef: row.anchorRef }),
    failReason: row.failReason,
    interactiveUrl: row.provider === 'sep24' ? row.interactiveUrl : null,
    createdAt: row.createdAt.toISOString(),
    ...(row.completedAt !== null && { completedAt: row.completedAt.toISOString() }),
  };
}
