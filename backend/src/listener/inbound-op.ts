/**
 * One Horizon payments-endpoint record, reduced to what the matcher needs. Built from the SDK's
 * record (stream and REST alike), where `.join('transactions')` puts the transaction in
 * `transaction_attr`; a raw Horizon JSON record has it in `transaction`. The SDK also turns every
 * linked field into a function and moves its value to `<name>_attr`: the transaction's `ledger` is
 * a function there and the number is in `ledger_attr` (observed on testnet, stellar-sdk 16.3).
 */
export interface InboundOp {
  opId: string;
  pagingToken: string;
  /** payment | path_payment_strict_receive | path_payment_strict_send | create_account | … */
  type: string;
  successful: boolean;
  from: string | null;
  to: string | null;
  /** native | credit_alphanum4 | credit_alphanum12 | … (for path payments: the asset received) */
  assetType: string | null;
  assetCode: string | null;
  assetIssuer: string | null;
  /** Decimal string as Horizon sends it (7 dp). For path payments: the amount received. */
  amount: string | null;
  txHash: string;
  ledger: number | null;
  /** Ledger close time of the transaction: when the payment was made. */
  createdAt: Date;
  memoType: string | null;
  /** Base64 of the raw memo bytes; set for text memos only. */
  memoBytes: string | null;
}

const PAYMENT_TYPES = new Set(['payment', 'path_payment_strict_receive', 'path_payment_strict_send']);

export function isPaymentType(type: string): boolean {
  return PAYMENT_TYPES.has(type);
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Throws on a record without the identity fields; everything else may be null. */
export function toInboundOp(raw: unknown): InboundOp {
  const r = (raw ?? {}) as Raw;
  const tx = (typeof r.transaction_attr === 'object' && r.transaction_attr !== null
    ? r.transaction_attr
    : typeof r.transaction === 'object' && r.transaction !== null
      ? r.transaction
      : {}) as Raw;
  const opId = str(r.id);
  const pagingToken = str(r.paging_token);
  const txHash = str(r.transaction_hash);
  const createdAt = str(tx.created_at) ?? str(r.created_at);
  if (!opId || !pagingToken || !txHash || !createdAt) {
    throw new Error(`Horizon record without id / paging_token / transaction_hash / created_at: ${JSON.stringify(r).slice(0, 300)}`);
  }
  return {
    opId,
    pagingToken,
    type: str(r.type) ?? 'unknown',
    successful: r.transaction_successful !== false && tx.successful !== false,
    from: str(r.from),
    to: str(r.to),
    assetType: str(r.asset_type),
    assetCode: str(r.asset_code),
    assetIssuer: str(r.asset_issuer),
    amount: str(r.amount),
    txHash,
    ledger: typeof tx.ledger_attr === 'number' ? tx.ledger_attr : typeof tx.ledger === 'number' ? tx.ledger : null,
    createdAt: new Date(createdAt),
    memoType: str(tx.memo_type),
    memoBytes: str(tx.memo_bytes),
  };
}
