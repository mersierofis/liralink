import { type rpc, scValToNative } from '@stellar/stellar-sdk';
import { USDC_DP, formatUSDC, isUSDCAmount } from '../common/money';

// Pure helpers for the Soroban invoice contract (contracts/invoice, 00-PROJECT.md §7). No I/O.

/** Mirrors `Error` in contracts/invoice/src/lib.rs. */
export const INVOICE_ERROR = {
  AlreadyExists: 1,
  NotFound: 2,
  NotPending: 3,
  Expired: 4,
  InvalidAmount: 5,
} as const;

// Testnet closes a ledger every ~5 s. Dividing by 6 puts the on-chain deadline a little before the
// link's expiresAt, so the contract never accepts a payment for a link the API has already expired.
const CONSERVATIVE_LEDGER_SECONDS = 6;

/** "147.0588236" → 1470588236n, "1.5" → 15000000n. More than 7 dp is refused: never round money. */
export function usdcToStroops(amount: string): bigint {
  if (!isUSDCAmount(amount)) throw new Error(`USDC amount ${JSON.stringify(amount)} is not a decimal with at most 7 dp`);
  const [whole, frac] = formatUSDC(amount).split('.'); // exactly 7 dp: pads, never rounds a valid amount
  return BigInt(whole) * 10n ** BigInt(USDC_DP) + BigInt(frac);
}

/** 1470588236n → "147.0588236". */
export function stroopsToUSDC(stroops: bigint): string {
  if (stroops < 0n) throw new Error(`negative USDC amount ${stroops}`);
  const s = stroops.toString().padStart(USDC_DP + 1, '0');
  return `${s.slice(0, -USDC_DP)}.${s.slice(-USDC_DP)}`;
}

/** The ledger at which the on-chain invoice stops accepting payment: never after `expiresAt`. */
export function deadlineLedgerFor(expiresAt: Date, now: Date, currentLedger: number): number {
  const secondsLeft = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  return currentLedger + Math.max(0, Math.floor(secondsLeft / CONSERVATIVE_LEDGER_SECONDS));
}

/** A `["paid", code]` → `{ payer, merchant, amount }` event, with where and when it happened. */
export interface PaidEvent {
  /** RPC event id: unique per event, the idempotency key. */
  eventId: string;
  txHash: string;
  ledger: number;
  /** Ledger close time: when the payment was made. */
  paidAt: Date;
  code: string;
  payer: string;
  /** Payout address the contract transferred to. */
  merchant: string;
  /** 7-dp decimal string. */
  amountUSDC: string;
}

/** Decodes a successful `paid` event; null for any other event, a failed call or a malformed one. */
export function parsePaidEvent(event: Pick<rpc.Api.EventResponse, 'id' | 'txHash' | 'ledger' | 'ledgerClosedAt' | 'inSuccessfulContractCall' | 'topic' | 'value'>): PaidEvent | null {
  if (!event.inSuccessfulContractCall || event.topic.length !== 2) return null;
  if (scValToNative(event.topic[0]) !== 'paid') return null;
  const code = scValToNative(event.topic[1]);
  const data = scValToNative(event.value) as Record<string, unknown> | null;
  if (typeof code !== 'string' || !data || typeof data.payer !== 'string' || typeof data.merchant !== 'string' || typeof data.amount !== 'bigint') {
    return null;
  }
  return {
    eventId: event.id,
    txHash: event.txHash,
    ledger: event.ledger,
    paidAt: new Date(event.ledgerClosedAt),
    code,
    payer: data.payer,
    merchant: data.merchant,
    amountUSDC: stroopsToUSDC(data.amount),
  };
}

/** The INVOICE_ERROR code in a simulation error such as `HostError: Error(Contract, #1)`; null if none. */
export function contractErrorCode(message: string): number | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(message);
  return Object.values(INVOICE_ERROR).find((code) => m !== null && String(code) === m[1]) ?? null;
}
