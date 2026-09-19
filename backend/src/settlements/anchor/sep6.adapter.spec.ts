import { Logger } from '@nestjs/common';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { merchantMemo } from '../merchant-memo';
import type { MerchantView, Progress, SettleContext, SettlementView } from './anchor-adapter';
import { AnchorHttp } from './anchor-http';
import { AnchorSession } from './anchor-session';
import { FAKE_DOMAIN, FAKE_TREASURY, FakeAnchor, FakePayer } from './fake-anchor.testing';
import { Sep6Adapter } from './sep6.adapter';

const MERCHANT = '5ebeff0f-e476-4699-90dc-ae8e69f9e093';
const MEMO = '3413587264431399756';
const IBAN = 'TR330006100519786457841326';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function setup() {
  const anchor = new FakeAnchor();
  const payer = new FakePayer(anchor);
  const platform = Keypair.random();
  const http = new AnchorHttp(anchor.fetch);
  const session = new AnchorSession({ homeDomain: FAKE_DOMAIN, networkPassphrase: Networks.TESTNET, keypair: platform, http, resolveToml: anchor.toml });
  let clock = 0;
  const adapter = new Sep6Adapter({
    session,
    http,
    payer,
    usdcIssuer: ISSUER,
    pollForMs: 30_000,
    pollEveryMs: 3_000,
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
  });

  const settlement: SettlementView = {
    id: 'settle-1', merchantId: MERCHANT, amountUSDC: '1.0300783', amountTRY: '50.00', status: 'pending',
    anchorRef: null, anchorMemo: null, anchorStatus: null, payTo: null, payMemo: null, payMemoType: null, paymentXdr: null, paymentTxHash: null,
  };
  const merchant: MerchantView = { id: MERCHANT, iban: IBAN, sep12CustomerId: null, sep12Iban: null, sep12HomeDomain: null };
  const progress: Progress[] = [];
  const ctx: SettleContext = {
    settlement,
    merchant,
    progress: async (p) => {
      progress.push(p);
      Object.assign(settlement, p); // what the service persists, the next run reads
    },
    saveSep12: async (c) => void Object.assign(merchant, c),
  };
  return { anchor, payer, adapter, ctx, settlement, merchant, progress, platform };
}

describe('Sep6Adapter against the observed tr-mock-anchor', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('happy path: one customer per merchant, IBAN over SEP-12, GET withdraw, one payment, netTRY from amount_out', async () => {
    const { anchor, payer, adapter, ctx, settlement, merchant } = setup();
    const out = await adapter.settle(ctx);

    expect(out).toEqual({ kind: 'completed', completion: { amountOutTRY: '50.00', feeUSDC: null } });
    // SEP-10 as the platform account with the merchant memo (first 63 bits of the UUID).
    const challenge = anchor.calls.find((c) => c.path === '/auth' && c.method === 'GET')!;
    expect(challenge.query).toMatchObject({ memo: merchantMemo(MERCHANT), home_domain: FAKE_DOMAIN });
    expect(MEMO).toBe(merchantMemo(MERCHANT));
    // SEP-12: the IBAN as bank_account_number in a multipart body; never in any query string.
    expect(anchor.calls.find((c) => c.method === 'PUT')!.form).toEqual({ bank_account_number: IBAN });
    for (const c of anchor.calls) expect(JSON.stringify(c.query)).not.toContain(IBAN);
    expect(merchant).toMatchObject({ sep12CustomerId: 'cus_1', sep12Iban: IBAN, sep12HomeDomain: FAKE_DOMAIN });
    // SEP-6 withdraw: GET, funding_method (not the deprecated type), no dest.
    const w = anchor.calls.find((c) => c.path === '/sep6/withdraw')!;
    expect(w.method).toBe('GET');
    expect(w.query).toEqual({ asset_code: 'USDC', asset_issuer: ISSUER, funding_method: 'bank_account', amount: '1.0300783', account: expect.any(String) });
    // Exactly one USDC payment, to the treasury, with the memo the anchor asked for, stored first.
    expect(payer.built).toEqual([{ to: FAKE_TREASURY, amountUSDC: '1.0300783', memo: settlement.payMemo, memoType: 'id', hash: expect.any(String) }]);
    expect(payer.submitted).toHaveLength(1);
    expect(settlement).toMatchObject({ status: 'processing', anchorRef: 'sep_2', anchorMemo: MEMO, anchorStatus: 'completed', paymentTxHash: payer.built[0].hash });
  });

  it('anchor rejects the amount (1 USDC minimum, whatever /info says) → blocked outside_anchor_limits, nothing sent', async () => {
    const { adapter, ctx, payer, settlement } = setup();
    settlement.amountUSDC = '0.7000000';
    expect(await adapter.settle(ctx)).toEqual({ kind: 'blocked', blockedReason: 'outside_anchor_limits' });
    expect(payer.built).toHaveLength(0);
    expect(settlement.anchorRef).toBeNull();
  });

  it('a large amount the /info max (300) would forbid is attempted — the anchor accepts it', async () => {
    const { adapter, ctx, settlement } = setup();
    settlement.amountUSDC = '5000.0000000';
    expect((await adapter.settle(ctx)).kind).toBe('completed');
  });

  it('no IBAN → blocked missing_iban; an IBAN the anchor rejects → blocked missing_iban; nothing opened', async () => {
    const a = setup();
    a.merchant.iban = null;
    expect(await a.adapter.settle(a.ctx)).toEqual({ kind: 'blocked', blockedReason: 'missing_iban' });
    const b = setup();
    b.merchant.iban = 'TR3300061005197864578413';
    expect(await b.adapter.settle(b.ctx)).toEqual({ kind: 'blocked', blockedReason: 'missing_iban' });
    expect(b.anchor.txs.size).toBe(0);
  });

  it.each(['pending_customer_info_update', 'pending_transaction_info_update'] as const)(
    '%s counts as in progress: recorded in blockedReason, cleared when the anchor moves on',
    async (status) => {
      const { anchor, adapter, ctx, progress } = setup();
      anchor.afterPayment = Array(20).fill(status);
      expect(await adapter.settle(ctx)).toEqual({ kind: 'waiting' });
      expect(progress).toContainEqual({ anchorStatus: status, blockedReason: status });

      [...anchor.txs.values()][0].script = ['pending_anchor', 'completed'];
      expect((await adapter.settle(ctx)).kind).toBe('completed');
      expect(progress).toContainEqual({ anchorStatus: 'pending_anchor', blockedReason: null });
    },
  );

  it.each(['error', 'expired', 'refunded', 'no_market', 'too_small', 'too_large'])('anchor status %s → failed anchor_status', async (status) => {
    const { anchor, adapter, ctx } = setup();
    anchor.afterPayment = [status];
    expect(await adapter.settle(ctx)).toEqual({ kind: 'failed', failReason: 'anchor_status' });
  });

  it('retry after a failed submission resubmits the SAME signed transaction — never a second payment', async () => {
    const { payer, adapter, ctx, settlement } = setup();
    payer.failSubmit = new Error('Horizon 504');
    await expect(adapter.settle(ctx)).rejects.toThrow('Horizon 504');
    expect(settlement.paymentTxHash).toBe(payer.built[0].hash); // stored before submission

    expect((await adapter.settle(ctx)).kind).toBe('completed');
    expect(payer.built).toHaveLength(1);
    expect(payer.submitted).toEqual([`xdr:${payer.built[0].hash}:${settlement.payMemo}`, `xdr:${payer.built[0].hash}:${settlement.payMemo}`]);
  });

  it('a payment that already landed is not resubmitted on resume', async () => {
    const { anchor, payer, adapter, ctx } = setup();
    await adapter.settle(ctx);
    // Crash replay: the anchor still shows pending_user_transfer_start, our payment is on the ledger.
    const tx = [...anchor.txs.values()][0];
    Object.assign(tx, { status: 'pending_user_transfer_start', script: ['completed'] });
    ctx.settlement.anchorStatus = null;
    expect((await adapter.settle(ctx)).kind).toBe('completed');
    expect(payer.submitted).toHaveLength(1);
    expect(payer.built).toHaveLength(1);
  });

  it('builds a new payment only when the stored one provably never landed', async () => {
    const { payer, adapter, ctx } = setup();
    payer.failSubmit = new Error('network down');
    await expect(adapter.settle(ctx)).rejects.toThrow();
    payer.expired = true; // a ledger closed after its maxTime and it is not on the ledger
    expect((await adapter.settle(ctx)).kind).toBe('completed');
    expect(payer.built).toHaveLength(2);
  });

  it('amount_in different from the settlement amount → failed amount_mismatch, nothing sent', async () => {
    const { anchor, adapter, ctx, payer } = setup();
    const orig = anchor.fetch;
    anchor.fetch = async (i, init) => {
      const res = await orig(i, init);
      if (String(i).includes('/sep6/transaction')) {
        const body = (await res.json()) as { transaction: Record<string, unknown> };
        body.transaction.amount_in = '9.0000000';
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return res;
    };
    const a = new Sep6Adapter({ ...(adapter as unknown as { o: ConstructorParameters<typeof Sep6Adapter>[0] }).o, http: new AnchorHttp(anchor.fetch) });
    expect(await a.settle(ctx)).toEqual({ kind: 'failed', failReason: 'amount_mismatch' });
    expect(payer.built).toHaveLength(0);
  });

  it('refuses an anchor that drops the memo from the JWT sub (it would merge every merchant)', async () => {
    const { anchor, adapter, ctx } = setup();
    anchor.dropMemoInSub = true;
    await expect(adapter.settle(ctx)).rejects.toThrow(/sub/);
  });

  it('re-registers the IBAN only when it changed; otherwise one GET confirms ACCEPTED', async () => {
    const { anchor, adapter, ctx, merchant } = setup();
    await adapter.settle(ctx);
    const second = setup();
    Object.assign(second.merchant, { sep12CustomerId: 'cus_1', sep12Iban: IBAN, sep12HomeDomain: FAKE_DOMAIN });
    second.anchor.customers.set(MEMO, { id: 'cus_1', iban: IBAN, status: 'ACCEPTED' });
    await second.adapter.settle(second.ctx);
    expect(second.anchor.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(anchor.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(merchant.sep12CustomerId).toBe('cus_1');
  });

  it('a 401 evicts the cached JWT so the next run logs in again', async () => {
    const { anchor, adapter, ctx } = setup();
    anchor.failNext = { path: '/sep12/customer', status: 401, body: { error: 'expired' } };
    await expect(adapter.settle(ctx)).rejects.toThrow(/401/);
    expect((await adapter.settle(ctx)).kind).toBe('completed');
    expect(anchor.calls.filter((c) => c.path === '/auth' && c.method === 'POST')).toHaveLength(2);
  });
});
