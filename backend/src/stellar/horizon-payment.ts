import type { InboundOp } from '../payments/payment-matcher';

const PAYMENT_TYPES = new Set(['payment', 'path_payment_strict_receive', 'path_payment_strict_send']);

/** Minimal shape we read from Horizon's payments stream (with `join: transactions`). */
export interface HorizonPaymentRecord {
  id: string;
  paging_token: string;
  type: string;
  from?: string;
  to?: string;
  amount?: string;
  destination_amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  transaction_hash: string;
  ledger_attr?: number;
  transaction?: {
    memo_type?: string | null;
    memo?: string | null;
    memo_bytes?: string | null;
    ledger?: number;
  } | null;
}

/**
 * Normalize a Horizon payment / path-payment record into an InboundOp.
 * Returns null for operation types we ignore (create_account, etc.).
 */
export function toInboundOp(rec: HorizonPaymentRecord): InboundOp | null {
  if (!PAYMENT_TYPES.has(rec.type)) return null;
  if (!rec.to || !rec.from) return null;

  // What landed on the destination:
  // - payment / path_payment_strict_receive: `amount` is the destination amount
  // - path_payment_strict_send: `destination_amount` is what was received
  const amount =
    rec.type === 'path_payment_strict_send' ? (rec.destination_amount ?? rec.amount) : rec.amount;
  if (!amount) return null;

  const assetType = rec.asset_type ?? 'native';
  const tx = rec.transaction ?? null;

  return {
    opId: rec.id,
    type: rec.type,
    from: rec.from,
    to: rec.to,
    amount,
    assetType,
    assetCode: assetType === 'native' ? null : (rec.asset_code ?? null),
    assetIssuer: assetType === 'native' ? null : (rec.asset_issuer ?? null),
    txHash: rec.transaction_hash,
    ledger: rec.ledger_attr ?? tx?.ledger ?? 0,
    pagingToken: rec.paging_token,
    memoType: tx?.memo_type ?? null,
    memoBytes: tx?.memo_bytes ?? null,
  };
}
