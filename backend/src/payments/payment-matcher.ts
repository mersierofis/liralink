import type { LinkStatus, PaymentAttemptReason } from '../contract/api.types';
import { addUSDC, compareDecimal, formatUSDC, subUSDC } from '../common/money';
import { normalizeLinkCode } from '../links/link-code';

/** A Horizon payment / path-payment operation already normalized for matching. */
export interface InboundOp {
  opId: string;
  type: string;
  from: string;
  to: string;
  /** Amount of the asset that landed on `to`, plain decimal string (Horizon's 7 dp). */
  amount: string;
  assetType: string;
  assetCode: string | null;
  assetIssuer: string | null;
  txHash: string;
  ledger: number;
  pagingToken: string;
  memoType: string | null;
  /** Base64 of the memo bytes — the only memo field the matcher trusts. */
  memoBytes: string | null;
}

export interface LinkForMatch {
  id: string;
  code: string;
  merchantId: string;
  status: LinkStatus;
  expiresAt: Date;
  quotedUSDC: string;
  receivedUSDC: string;
}

export interface MatcherConfig {
  platformAccount: string;
  usdcCode: string;
  usdcIssuer: string;
  /** Clock for the open-link expiry check. */
  now: Date;
}

export type MatchDecision =
  | {
      kind: 'credit';
      link: LinkForMatch;
      amountUSDC: string;
      /** receivedUSDC after applying this op (includes any overpay). */
      totalReceivedUSDC: string;
      status: 'paid' | 'underpaid';
      shortfallUSDC: string | null;
      /** Excess over quotedUSDC to credit as unallocated (overpaid); null if none. */
      excessUSDC: string | null;
    }
  | {
      kind: 'attempt';
      reason: PaymentAttemptReason;
      linkCode: string | null;
      merchantId: string | null;
      /** When reason is link_not_open: credit this USDC to the merchant as stray. */
      strayUSDC: string | null;
      amount: string;
      assetCode: string;
      assetIssuer: string | null;
    };

function isCircleUsdc(op: InboundOp, cfg: MatcherConfig): boolean {
  return (
    op.assetType === 'credit_alphanum4' &&
    op.assetCode === cfg.usdcCode &&
    op.assetIssuer === cfg.usdcIssuer
  );
}

/** Decode Horizon memo_bytes (base64) to UTF-8; null if missing/invalid. */
export function memoFromBytes(memoBytes: string | null): string | null {
  if (!memoBytes) return null;
  try {
    return Buffer.from(memoBytes, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Link code from memo_bytes only (01-BACKEND.md). memo_type must be text; bytes must decode to
 * exactly one normalized 8-char link code.
 */
export function linkCodeFromMemoBytes(memoType: string | null, memoBytes: string | null): string | null {
  if (memoType !== 'text') return null;
  const text = memoFromBytes(memoBytes);
  if (text === null) return null;
  return normalizeLinkCode(text);
}

/** Base64 of a link code, as Horizon stores text-memo bytes. */
export function memoBytesForCode(code: string): string {
  return Buffer.from(code, 'utf8').toString('base64');
}

/**
 * Pure matcher: (operation, link | null, config) → decision.
 * Does not touch the DB. Underpaid links stay payable past expiresAt; open links do not.
 */
export function matchInbound(op: InboundOp, link: LinkForMatch | null, cfg: MatcherConfig): MatchDecision {
  const assetCode = op.assetType === 'native' ? 'XLM' : (op.assetCode ?? 'UNKNOWN');
  const assetIssuer = op.assetType === 'native' ? null : op.assetIssuer;
  const amountFormatted = formatUSDC(op.amount);

  if (op.to !== cfg.platformAccount) {
    return {
      kind: 'attempt',
      reason: 'unmatched_memo',
      linkCode: null,
      merchantId: null,
      strayUSDC: null,
      amount: amountFormatted,
      assetCode,
      assetIssuer,
    };
  }

  if (!isCircleUsdc(op, cfg)) {
    return {
      kind: 'attempt',
      reason: 'wrong_asset',
      linkCode: linkCodeFromMemoBytes(op.memoType, op.memoBytes),
      merchantId: link?.merchantId ?? null,
      strayUSDC: null,
      amount: amountFormatted,
      assetCode,
      assetIssuer,
    };
  }

  const code = linkCodeFromMemoBytes(op.memoType, op.memoBytes);
  if (!code) {
    return {
      kind: 'attempt',
      reason: 'unmatched_memo',
      linkCode: null,
      merchantId: null,
      strayUSDC: null,
      amount: amountFormatted,
      assetCode: cfg.usdcCode,
      assetIssuer: cfg.usdcIssuer,
    };
  }

  if (!link) {
    return {
      kind: 'attempt',
      reason: 'link_not_found',
      linkCode: code,
      merchantId: null,
      strayUSDC: null,
      amount: amountFormatted,
      assetCode: cfg.usdcCode,
      assetIssuer: cfg.usdcIssuer,
    };
  }

  const payable =
    link.status === 'underpaid' ||
    (link.status === 'open' && link.expiresAt.getTime() > cfg.now.getTime());

  if (!payable) {
    return {
      kind: 'attempt',
      reason: 'link_not_open',
      linkCode: link.code,
      merchantId: link.merchantId,
      strayUSDC: amountFormatted,
      amount: amountFormatted,
      assetCode: cfg.usdcCode,
      assetIssuer: cfg.usdcIssuer,
    };
  }

  const totalReceivedUSDC = addUSDC(link.receivedUSDC, amountFormatted);
  const cmp = compareDecimal(totalReceivedUSDC, link.quotedUSDC);

  if (cmp < 0) {
    return {
      kind: 'credit',
      link,
      amountUSDC: amountFormatted,
      totalReceivedUSDC,
      status: 'underpaid',
      shortfallUSDC: subUSDC(link.quotedUSDC, totalReceivedUSDC),
      excessUSDC: null,
    };
  }

  if (cmp === 0) {
    return {
      kind: 'credit',
      link,
      amountUSDC: amountFormatted,
      totalReceivedUSDC,
      status: 'paid',
      shortfallUSDC: null,
      excessUSDC: null,
    };
  }

  return {
    kind: 'credit',
    link,
    amountUSDC: amountFormatted,
    totalReceivedUSDC,
    status: 'paid',
    shortfallUSDC: null,
    excessUSDC: subUSDC(totalReceivedUSDC, link.quotedUSDC),
  };
}
