import type { Payment, PaymentLink } from '../contract/api.types';
import type { AppConfig } from '../config/app-config';
import type { Payment as PaymentRow, PaymentLink as PaymentLinkRow } from '../generated/prisma/client';
import { formatRate, formatTRY, formatUSDC } from '../common/money';

export type LinkWithPayments = PaymentLinkRow & { payments: PaymentRow[] };

/** Prisma `include` that every link read uses: payments oldest → newest. */
export const withPayments = { payments: { orderBy: [{ detectedAt: 'asc' as const }, { id: 'asc' as const }] } };

export function toPayment(row: PaymentRow, config: AppConfig): Payment {
  return {
    id: row.id,
    linkId: row.linkId,
    rail: row.rail,
    txHash: row.txHash,
    payerAddress: row.payerAddress,
    amountUSDC: formatUSDC(row.amountUSDC),
    ledger: row.ledger,
    explorerUrl: config.explorerTxUrl(row.txHash),
    detectedAt: row.detectedAt.toISOString(),
  };
}

export function toPaymentLink(row: LinkWithPayments, config: AppConfig): PaymentLink {
  const payments = row.payments.map((p) => toPayment(p, config));
  const latest = payments.at(-1);
  return {
    id: row.id,
    code: row.code,
    merchantId: row.merchantId,
    merchantName: row.merchantName,
    title: row.title,
    ...(row.description !== null && { description: row.description }),
    amountTRY: formatTRY(row.amountTRY),
    quotedUSDC: formatUSDC(row.quotedUSDC),
    fxRate: formatRate(row.fxRate),
    quoteExpiresAt: row.quoteExpiresAt.toISOString(),
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    payUrl: `${config.env.PAY_WEB_BASE_URL}/${row.code}`,
    receivedUSDC: formatUSDC(row.receivedUSDC),
    ...(row.status === 'underpaid' && row.shortfallUSDC !== null && { shortfallUSDC: formatUSDC(row.shortfallUSDC) }),
    ...(latest && { payment: latest }),
    payments,
    onchain:
      row.onchainContractId !== null && row.onchainInvoiceCode !== null && row.onchainDeadlineLedger !== null
        ? {
            contractId: row.onchainContractId,
            invoiceCode: row.onchainInvoiceCode,
            deadlineLedger: row.onchainDeadlineLedger,
            ...(row.onchainTxHash !== null && { txHash: row.onchainTxHash }),
          }
        : null,
    createdAt: row.createdAt.toISOString(),
  };
}
