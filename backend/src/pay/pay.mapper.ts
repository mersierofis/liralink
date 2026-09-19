import type { PayQuote } from '../contract/api.types';
import type { AppConfig } from '../config/app-config';
import { formatRate, formatSpread, formatTRY, formatUSDC } from '../common/money';
import { type LinkWithPayments, toPayment } from '../links/link.mapper';

/** What the payer page renders. No merchant id, no IBAN: only what a payer needs to pay. */
export function toPayQuote(row: LinkWithPayments, config: AppConfig): PayQuote {
  const payments = row.payments.map((p) => toPayment(p, config));
  const latest = payments.at(-1);
  return {
    code: row.code,
    merchantName: row.merchantName,
    title: row.title,
    ...(row.description !== null && { description: row.description }),
    amountTRY: formatTRY(row.amountTRY),
    amountUSDC: formatUSDC(row.quotedUSDC),
    fxRate: formatRate(row.fxRate),
    fxRateAt: row.fxRateAt.toISOString(),
    fxSpread: row.fxSpread === null ? null : formatSpread(row.fxSpread),
    quoteExpiresAt: row.quoteExpiresAt.toISOString(),
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    receivedUSDC: formatUSDC(row.receivedUSDC),
    ...(row.status === 'underpaid' && row.shortfallUSDC !== null && { shortfallUSDC: formatUSDC(row.shortfallUSDC) }),
    rails: {
      // The contract rail is not wired in this build, so `rails.contract` is never present yet.
      memo: { destination: config.platformAccount, memo: row.code },
    },
    asset: { code: config.env.USDC_CODE, issuer: config.env.USDC_ISSUER },
    network: config.env.STELLAR_NETWORK,
    ...(latest && { payment: latest }),
    payments,
  };
}
