import type { LinkStatus, PaymentAttemptReason } from '../contract/api.types';
import { addUSDC, compareDecimal, isUSDCAmount, subtractUSDC } from '../common/money';
import { LINK_CODE_ALPHABET, LINK_CODE_LENGTH } from '../links/link-code';
import { type InboundOp, isPaymentType } from './inbound-op';

// Pure functions: (operation, link, config) → decision. No I/O, so every branch is unit-tested.

export interface MatcherConfig {
  platformAccount: string;
  usdcCode: string;
  usdcIssuer: string;
}

/** Step 1, without the database: is this an incoming payment, in which asset, for which code? */
export type Classified =
  | { kind: 'ignore'; why: string }
  | { kind: 'wrong_asset'; code: string | null; amount: string; assetCode: string; assetIssuer: string | null }
  | { kind: 'unmatched_memo'; amount: string }
  | { kind: 'usdc'; code: string; amount: string };

const CODE_BYTES = new RegExp(`^[${LINK_CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`);

/**
 * The link code carried by the memo: text memos only, read from `memo_bytes` (base64 of the raw
 * bytes), never from the lossy UTF-8 `memo` field. The bytes must be exactly a code.
 */
export function memoLinkCode(op: InboundOp): string | null {
  if (op.memoType !== 'text' || op.memoBytes === null) return null;
  const text = Buffer.from(op.memoBytes, 'base64').toString('latin1');
  return CODE_BYTES.test(text) ? text : null;
}

export function classify(op: InboundOp, cfg: MatcherConfig): Classified {
  if (!isPaymentType(op.type)) return { kind: 'ignore', why: `type ${op.type}` };
  if (!op.successful) return { kind: 'ignore', why: 'failed transaction' };
  if (op.to !== cfg.platformAccount) return { kind: 'ignore', why: 'outgoing' };
  if (!isUSDCAmount(op.amount)) throw new Error(`op ${op.opId}: amount ${JSON.stringify(op.amount)} is not a 7-dp decimal`);

  const code = memoLinkCode(op);
  // USDC only when code AND issuer match together: anyone can issue a token called "USDC".
  const isUSDC = op.assetType === 'credit_alphanum4' && op.assetCode === cfg.usdcCode && op.assetIssuer === cfg.usdcIssuer;
  if (!isUSDC) {
    const native = op.assetType === 'native';
    return {
      kind: 'wrong_asset',
      code,
      amount: op.amount,
      assetCode: native ? 'XLM' : (op.assetCode ?? op.assetType ?? 'unknown'),
      assetIssuer: native ? null : op.assetIssuer,
    };
  }
  return code ? { kind: 'usdc', code, amount: op.amount } : { kind: 'unmatched_memo', amount: op.amount };
}

/** The link as the matcher sees it. */
export interface LinkState {
  id: string;
  code: string;
  merchantId: string;
  status: LinkStatus;
  quotedUSDC: string;
  receivedUSDC: string;
  expiresAt: Date;
}

/**
 * Can this link take a payment made at `paidAt`? Only a link with no payments expires, judged by
 * when the payment was made on the ledger (not when we saw it): an 'open' link is payable until
 * expiresAt; an 'expired' one still is for a payment made before expiresAt (it was expired by the
 * clock while the listener lagged); 'underpaid' is payable forever; 'paid'/'cancelled' never.
 */
export function isPayable(link: LinkState, paidAt: Date): boolean {
  switch (link.status) {
    case 'underpaid':
      return true;
    case 'open':
    case 'expired':
      return paidAt < link.expiresAt;
    default:
      return false;
  }
}

/** Exact-amount policy on the locked quotedUSDC. */
export interface Credit {
  receivedUSDC: string;
  status: 'paid' | 'underpaid';
  /** Set only while underpaid. */
  shortfallUSDC: string | null;
  /** Overpaid part, credited to merchant.unallocatedUSDC; null if none. */
  excessUSDC: string | null;
}

export function applyExactAmount(quotedUSDC: string, receivedUSDC: string, amount: string): Credit {
  const total = addUSDC(receivedUSDC, amount);
  const cmp = compareDecimal(total, quotedUSDC);
  if (cmp < 0) return { receivedUSDC: total, status: 'underpaid', shortfallUSDC: subtractUSDC(quotedUSDC, total), excessUSDC: null };
  if (cmp === 0) return { receivedUSDC: total, status: 'paid', shortfallUSDC: null, excessUSDC: null };
  return { receivedUSDC: total, status: 'paid', shortfallUSDC: null, excessUSDC: subtractUSDC(total, quotedUSDC) };
}

/** Step 2, with the link (if the code named one): what happens to the money. Never "drop". */
export type Decision =
  | { kind: 'ignore'; why: string }
  | {
      kind: 'attempt';
      reason: Exclude<PaymentAttemptReason, 'link_not_open'>;
      linkCode: string | null;
      merchantId: string | null;
      amount: string;
      assetCode: string;
      assetIssuer: string | null;
    }
  | { kind: 'stray'; link: LinkState; amount: string; expireLink: boolean }
  | { kind: 'credit'; link: LinkState; amount: string; credit: Credit };

export function decide(c: Classified, link: LinkState | null, paidAt: Date, cfg: MatcherConfig): Decision {
  switch (c.kind) {
    case 'ignore':
      return c;
    case 'wrong_asset':
      // Nothing is credited: the asset is not our USDC. The link is named only for the record.
      return {
        kind: 'attempt',
        reason: 'wrong_asset',
        linkCode: c.code,
        merchantId: link?.merchantId ?? null,
        amount: c.amount,
        assetCode: c.assetCode,
        assetIssuer: c.assetIssuer,
      };
    case 'unmatched_memo':
      return { kind: 'attempt', reason: 'unmatched_memo', linkCode: null, merchantId: null, amount: c.amount, assetCode: cfg.usdcCode, assetIssuer: cfg.usdcIssuer };
    case 'usdc':
      if (!link) {
        return { kind: 'attempt', reason: 'link_not_found', linkCode: c.code, merchantId: null, amount: c.amount, assetCode: cfg.usdcCode, assetIssuer: cfg.usdcIssuer };
      }
      if (!isPayable(link, paidAt)) {
        // An open link whose time ran out before this payment is expired now, in the same step.
        return { kind: 'stray', link, amount: c.amount, expireLink: link.status === 'open' };
      }
      return { kind: 'credit', link, amount: c.amount, credit: applyExactAmount(link.quotedUSDC, link.receivedUSDC, c.amount) };
  }
}
