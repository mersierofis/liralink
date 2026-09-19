import { Logger } from '@nestjs/common';
import { compareDecimal, isUSDCAmount, sameDecimal } from '../../common/money';
import { merchantMemo } from '../merchant-memo';
import type { AnchorCompletion } from '../settlement-math';
import type { AnchorAdapter, SettleContext, SettleOutcome, SettlementView } from './anchor-adapter';
import { AnchorHttp, AnchorHttpError, redactIban } from './anchor-http';
import type { AnchorSession } from './anchor-session';
import type { StellarPayer } from './stellar-payer';

export interface Sep6Options {
  session: AnchorSession;
  http: AnchorHttp;
  payer: StellarPayer;
  usdcIssuer: string;
  /** How long one call follows the anchor before returning `waiting` (anchor.md: 2 min). */
  pollForMs?: number;
  pollEveryMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const FAILED_STATUSES = new Set(['error', 'expired', 'refunded', 'no_market', 'too_small', 'too_large']);
const INFO_STATUSES = new Set(['pending_customer_info_update', 'pending_transaction_info_update']);

interface AnchorTx {
  id?: string;
  status?: string;
  amount_in?: string;
  amount_in_asset?: string;
  amount_out?: string;
  amount_out_asset?: string;
  amount_fee?: string;
  amount_fee_asset?: string;
  fee_details?: { total?: string; asset?: string };
  to?: string;
}

/**
 * The TRY rail over SEP-6 against the hackathon anchor (anchor.md). Auto-payout: the anchor pays the
 * merchant's SEP-12-registered IBAN. What the anchor DOES, not what its docs say:
 * - withdraw is `GET /withdraw` with query parameters — POST (multipart or JSON) is 404 here;
 * - the IBAN never goes in a query (`dest` is PII and ignored): it is registered over SEP-12;
 * - `/info` limits are wrong both ways (0.7 rejected under a 0.5 min, 5000 accepted over a 300
 *   max): there is no pre-check, an amount-shaped 4xx blocks with `outside_anchor_limits`;
 * - the fee is booked in TRY and `amount_out` is already net.
 */
export class Sep6Adapter implements AnchorAdapter {
  readonly name = 'sep6' as const;
  readonly settlementMode = 'auto_payout' as const;
  private readonly logger = new Logger(Sep6Adapter.name);
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly o: Sep6Options) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  private get usdcSep38(): string {
    return `stellar:USDC:${this.o.usdcIssuer}`;
  }

  async settle(ctx: SettleContext): Promise<SettleOutcome> {
    const s = { ...ctx.settlement };
    // A withdrawal always continues as the identity that opened it.
    const memo = s.anchorMemo ?? merchantMemo(ctx.merchant.id);
    try {
      if (!s.anchorRef) {
        const blocked = await this.open(ctx, s, memo);
        if (blocked) return blocked;
      }
      return await this.follow(ctx, s, memo);
    } catch (err) {
      if (err instanceof AnchorHttpError && (err.status === 401 || err.status === 403)) this.o.session.evict(memo);
      throw err;
    }
  }

  /** Steps 2, 4, 5: IBAN present, registered over SEP-12, withdrawal opened. Nothing is sent. */
  private async open(ctx: SettleContext, s: SettlementView, memo: string): Promise<SettleOutcome | null> {
    const iban = ctx.merchant.iban;
    if (!iban) return { kind: 'blocked', blockedReason: 'missing_iban' };
    const jwt = await this.o.session.jwt(memo);
    const ep = await this.o.session.endpoints();

    if (!(await this.ensureCustomer(ctx, jwt, iban, ep.kycServer))) return { kind: 'blocked', blockedReason: 'missing_iban' };

    let w: { id?: string; account_id?: string; memo?: string; memo_type?: string };
    try {
      w = await this.o.http.call('SEP-6 withdraw', {
        method: 'GET',
        url: `${ep.transferServer}/withdraw`,
        jwt,
        query: {
          asset_code: 'USDC',
          asset_issuer: this.o.usdcIssuer,
          funding_method: 'bank_account',
          amount: s.amountUSDC,
          account: this.o.session.account,
        },
      });
    } catch (err) {
      if (err instanceof AnchorHttpError && err.status >= 400 && err.status < 500 && ![401, 403].includes(err.status)) {
        if (/min|max|amount|limit|too (small|large)/i.test(err.body)) {
          this.logger.warn(`settlement ${s.id}: anchor refused the amount ${s.amountUSDC}: ${err.message}`);
          return { kind: 'blocked', blockedReason: 'outside_anchor_limits' };
        }
        if (/disabled|not enabled/i.test(err.body)) return { kind: 'blocked', blockedReason: 'anchor_withdraw_disabled' };
      }
      throw err;
    }
    if (!w.id || !w.account_id || w.memo === undefined || !w.memo_type) throw new Error(`SEP-6 withdraw answer incomplete: ${JSON.stringify(w).slice(0, 200)}`);

    const p = { status: 'processing' as const, anchorRef: w.id, anchorMemo: memo, payTo: w.account_id, payMemo: String(w.memo), payMemoType: w.memo_type, blockedReason: null };
    await ctx.progress(p);
    Object.assign(s, p);
    return null;
  }

  /**
   * SEP-12 (step 4): register the payout IBAN as bank_account_number — never in a query. Re-register
   * when the IBAN or home domain changed; otherwise one GET confirms it is still ACCEPTED (a
   * sandbox reset shows NEEDS_INFO or another id). A 400 means the anchor rejected the IBAN.
   */
  private async ensureCustomer(ctx: SettleContext, jwt: string, iban: string, kycServer: string | null): Promise<boolean> {
    if (!kycServer) throw new Error('anchor has no KYC_SERVER: cannot register the payout IBAN, refusing to pay an unknown account');
    const m = ctx.merchant;
    const domain = this.o.session.homeDomain;
    if (m.sep12CustomerId && m.sep12Iban === iban && m.sep12HomeDomain === domain) {
      const c = await this.o.http.call<{ id?: string; status?: string }>('SEP-12 get customer', { method: 'GET', url: `${kycServer}/customer`, jwt });
      if (c.status === 'ACCEPTED' && c.id === m.sep12CustomerId) return true;
    }
    try {
      const r = await this.o.http.call<{ id?: string }>('SEP-12 put customer', {
        method: 'PUT',
        url: `${kycServer}/customer`,
        jwt,
        form: { bank_account_number: iban },
      });
      if (!r.id) throw new Error('SEP-12 answered without a customer id');
      await ctx.saveSep12({ sep12CustomerId: r.id, sep12Iban: iban, sep12HomeDomain: domain });
      Object.assign(ctx.merchant, { sep12CustomerId: r.id, sep12Iban: iban, sep12HomeDomain: domain });
      return true;
    } catch (err) {
      if (err instanceof AnchorHttpError && err.status === 400) {
        this.logger.warn(`merchant ${m.id}: anchor rejected the IBAN: ${err.message}`);
        return false;
      }
      throw err;
    }
  }

  /** Steps 6–7: pay the anchor exactly once, then follow the transaction to a final state. */
  private async follow(ctx: SettleContext, s: SettlementView, memo: string): Promise<SettleOutcome> {
    const pollFor = this.o.pollForMs ?? 120_000;
    const pollEvery = this.o.pollEveryMs ?? 3_000;
    const until = this.now() + pollFor;
    const ep = await this.o.session.endpoints();

    for (;;) {
      const jwt = await this.o.session.jwt(memo);
      const { transaction: tx } = await this.o.http.call<{ transaction?: AnchorTx }>('SEP-6 transaction', {
        method: 'GET',
        url: `${ep.transferServer}/transaction`,
        jwt,
        query: { id: s.anchorRef! },
      });
      if (!tx?.status) throw new Error('SEP-6 transaction answer without status');
      if (tx.status !== s.anchorStatus) {
        const blocked = INFO_STATUSES.has(tx.status) ? (tx.status as 'pending_customer_info_update' | 'pending_transaction_info_update') : null;
        await ctx.progress({ anchorStatus: tx.status, blockedReason: blocked });
        s.anchorStatus = tx.status;
        if (blocked) this.logger.warn(`settlement ${s.id}: anchor is waiting (${tx.status}); still in progress`);
      }

      if (tx.status === 'completed') return this.completed(ctx, s, tx);
      if (FAILED_STATUSES.has(tx.status)) return { kind: 'failed', failReason: 'anchor_status' };
      if (tx.status === 'pending_user_transfer_start') {
        // Nothing has been sent yet at this status: check the amount first, then pay exactly once.
        if (tx.amount_in !== undefined && isUSDCAmount(tx.amount_in) && !sameDecimal(tx.amount_in, s.amountUSDC)) {
          this.logger.error(`settlement ${s.id}: anchor amount_in ${tx.amount_in} != ${s.amountUSDC}; nothing sent`);
          return { kind: 'failed', failReason: 'amount_mismatch' };
        }
        await this.payOnce(ctx, s);
      }
      // Any other status (incomplete, pending_anchor, pending_external, pending_stellar, the two
      // info updates, …) is in progress.

      if (this.now() + pollEvery > until) return { kind: 'waiting' };
      await this.sleep(pollEvery);
    }
  }

  /**
   * The double-spend guard (anchor.md): the signed XDR and its hash are persisted BEFORE submission.
   * A retry resubmits that same transaction (same sequence: it lands at most once). A new one is
   * built only when the saved one provably never landed: failed on the ledger, or missing after a
   * ledger closed past its maxTime.
   */
  private async payOnce(ctx: SettleContext, s: SettlementView): Promise<void> {
    if (s.paymentTxHash && s.paymentXdr) {
      const state = await this.o.payer.lookup(s.paymentTxHash);
      if (state === 'success') return;
      if (state === 'missing' && !(await this.o.payer.provablyExpired(s.paymentXdr))) {
        await this.o.payer.submit(s.paymentXdr);
        return;
      }
      this.logger.warn(`settlement ${s.id}: payment ${s.paymentTxHash} ${state === 'failed' ? 'failed on the ledger' : 'expired unsent'}; building a new one`);
    }
    if (!s.payTo || s.payMemo === null || !s.payMemoType) throw new Error(`settlement ${s.id}: no pay-to details stored`);
    const built = await this.o.payer.build({ to: s.payTo, amountUSDC: s.amountUSDC, memo: s.payMemo, memoType: s.payMemoType });
    await ctx.progress({ paymentXdr: built.xdr, paymentTxHash: built.hash });
    Object.assign(s, { paymentXdr: built.xdr, paymentTxHash: built.hash });
    await this.o.payer.submit(built.xdr);
  }

  /** How the money is booked: this anchor reports the TRY it paid (amount_out), fee in TRY. */
  private completed(ctx: SettleContext, s: SettlementView, tx: AnchorTx): SettleOutcome {
    const outAsset = tx.amount_out_asset;
    const feeAsset = tx.fee_details?.asset ?? tx.amount_fee_asset;
    const outIsTRY = outAsset === 'iso4217:TRY' || (outAsset === undefined && feeAsset === 'iso4217:TRY');
    const completion: AnchorCompletion = {
      amountOutTRY: outIsTRY && typeof tx.amount_out === 'string' ? tx.amount_out : null,
      feeUSDC: feeAsset === this.usdcSep38 ? (tx.fee_details?.total ?? tx.amount_fee ?? null) : null,
    };
    if (tx.amount_in !== undefined && isUSDCAmount(tx.amount_in) && compareDecimal(tx.amount_in, s.amountUSDC) !== 0) {
      this.logger.error(`settlement ${s.id}: completed with amount_in ${tx.amount_in} != ${s.amountUSDC}; booked as reported, reconcile by hand`);
    }
    // The money already moved: a payout to someone else is logged for reconciliation, not failed.
    const iban = ctx.merchant.iban;
    if (tx.to && iban && tx.to.replace(/\s/g, '') !== iban) {
      this.logger.error(redactIban(`settlement ${s.id}: anchor paid ${tx.to}, not the merchant's IBAN ${iban}; SEP-12 registration did not take`));
    }
    return { kind: 'completed', completion };
  }
}
