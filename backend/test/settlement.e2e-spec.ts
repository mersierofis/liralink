import { Keypair, Networks } from '@stellar/stellar-sdk';
import type { AppConfig } from '../src/config/app-config';
import { PAYMENT_DETECTED, PaymentEvents } from '../src/listener/payment-events';
import type { AnchorAdapter } from '../src/settlements/anchor/anchor-adapter';
import { AnchorHttp } from '../src/settlements/anchor/anchor-http';
import { AnchorSession } from '../src/settlements/anchor/anchor-session';
import { FAKE_DOMAIN, FakeAnchor, FakePayer } from '../src/settlements/anchor/fake-anchor.testing';
import { MockAnchorAdapter } from '../src/settlements/anchor/mock.adapter';
import { Sep6Adapter } from '../src/settlements/anchor/sep6.adapter';
import { SettlementsService } from '../src/settlements/settlements.service';
import { FakePaymentSource, QUOTED, createTestApp, record, registerMerchant, resetDb, type TestApp, type TestAppOptions } from './helpers';

const IBAN = 'TR330006100519786457841326';
const SETTLEMENT_KEYS = [
  'id', 'merchantId', 'paymentId', 'amountUSDC', 'amountTRY', 'fxRate', 'savedUSDC', 'feeUSDC', 'netTRY',
  'provider', 'status', 'anchorRef', 'failReason', 'interactiveUrl', 'createdAt', 'completedAt',
].sort();

async function waitFor<T>(what: string, fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Settlement (e2e)', () => {
  let t: TestApp;
  let platform: string;
  let auth: { Authorization: string };
  let anchor: FakeAnchor;
  let payer: FakePayer;

  /** A sep6 adapter over the fake anchor, plus a mock one, exactly as the module would wire them. */
  const sep6Adapters = (mockDelayMs = 20) => (config: AppConfig): AnchorAdapter[] => {
    const http = new AnchorHttp(anchor.fetch);
    const keypair = Keypair.fromSecret(config.env.PLATFORM_ACCOUNT_SECRET);
    return [
      new MockAnchorAdapter(mockDelayMs),
      new Sep6Adapter({
        session: new AnchorSession({ homeDomain: FAKE_DOMAIN, networkPassphrase: Networks.TESTNET, keypair, http, resolveToml: anchor.toml }),
        http,
        payer,
        usdcIssuer: config.env.USDC_ISSUER,
        pollEveryMs: 5,
        pollForMs: 500,
      }),
    ];
  };

  async function boot(opts: TestAppOptions = {}): Promise<void> {
    anchor = new FakeAnchor();
    payer = new FakePayer(anchor);
    t = await createTestApp(new FakePaymentSource(), opts);
    platform = t.app.get(PaymentEvents) && (await t.http().get('/api/health')).body.platformAccount;
    await resetDb(t.prisma);
    await t.listener.connect();
    await t.listener.idle();
    const { token } = await registerMerchant(t);
    auth = { Authorization: `Bearer ${token}` };
  }
  const sep6 = (mockDelayMs?: number): TestAppOptions => ({ env: { ANCHOR_PROVIDER: 'sep6', ANCHOR_HOME_DOMAIN: FAKE_DOMAIN }, adapters: sep6Adapters(mockDelayMs) });

  afterEach(() => t?.close());

  const svc = () => t.app.get(SettlementsService);
  const newLink = async (amountTRY = '5000.00') =>
    (await t.http().post('/api/links').set(auth).send({ title: 'Lemon order #1042', amountTRY }).expect(201)).body;
  const pay = async (code: string, amount = QUOTED) => {
    const r = record(platform, { code, amount });
    t.source.push(r);
    await t.listener.idle();
    return r;
  };
  const settlements = async () => (await t.http().get('/api/settlements').set(auth).expect(200)).body;
  const balance = async () => (await t.http().get('/api/balance').set(auth).expect(200)).body;
  const settled = (status = 'completed') =>
    waitFor(`settlement ${status}`, settlements, (b: { items: { status: string; [k: string]: unknown }[] }) => b.items[0]?.status === status);
  const setIban = () => t.http().patch('/api/me').set(auth).send({ iban: IBAN }).expect(200);

  describe('balance mode (mock anchor)', () => {
    it('a paid link settles for link.amountTRY; the TRY moves from pending to available', async () => {
      await boot({ adapters: () => [new MockAnchorAdapter(400)] });
      const link = await newLink();
      const r = await pay(link.code);

      const pending = await waitFor('processing', balance, (b: { pendingTRY: string }) => b.pendingTRY === '5000.00');
      expect(pending).toMatchObject({ availableTRY: '0.00', pendingTRY: '5000.00' });

      const [s] = (await settled()).items;
      expect(Object.keys(s).sort()).toEqual(SETTLEMENT_KEYS); // no internal fields (blockedReason, memo, XDR…)
      expect(s).toMatchObject({
        amountTRY: '5000.00', // the link amount, never received × rate
        amountUSDC: QUOTED,
        savedUSDC: '0.0000000',
        fxRate: '34.0000000',
        feeUSDC: '0.0000000',
        netTRY: '5000.00',
        provider: 'mock',
        failReason: null,
        interactiveUrl: null,
      });
      expect(s.anchorRef).toBe(`mock-${s.id}`);
      expect(await balance()).toMatchObject({ availableTRY: '5000.00', pendingTRY: '0.00', paidOutTRY: '0.00' });

      const payments = (await t.http().get('/api/payments').set(auth).expect(200)).body;
      expect(payments.items[0]).toMatchObject({ txHash: r.transaction_hash, link: { code: link.code, status: 'paid' }, settlement: { id: s.id, status: 'completed' } });
    });

    it('auto-save 20 %: 80 % of the link converted, 20 % of the quote kept as saved USDC', async () => {
      await boot();
      await t.http().patch('/api/me').set(auth).send({ autoSavePercent: 20 }).expect(200);
      const link = await newLink('1000.00');
      await pay(link.code, link.quotedUSDC);
      const [s] = (await settled()).items;
      expect(s).toMatchObject({ amountTRY: '800.00', savedUSDC: '5.8823529', amountUSDC: '23.5294119', netTRY: '800.00' });
      expect(await balance()).toMatchObject({ availableTRY: '800.00', savedUSDC: '5.8823529' });
    });

    it('an overpaid link settles the link amount; the excess stays in unallocated USDC', async () => {
      await boot();
      const link = await newLink();
      await pay(link.code, '150.0000000');
      const [s] = (await settled()).items;
      expect(s).toMatchObject({ amountTRY: '5000.00', amountUSDC: QUOTED, netTRY: '5000.00' });
      expect(await balance()).toMatchObject({ availableTRY: '5000.00', unallocatedUSDC: '2.9411764' });
    });
  });

  describe('auto-payout (SEP-6 against the fake anchor)', () => {
    it('happy path: IBAN registered over SEP-12, one payment, netTRY = amount_out, paid-out TRY grows', async () => {
      await boot(sep6());
      await setIban();
      const link = await newLink();
      await pay(link.code);

      const [s] = (await settled()).items;
      expect(s).toMatchObject({ provider: 'sep6', amountTRY: '5000.00', feeUSDC: '0.0000000', netTRY: '50.00', anchorRef: 'sep_2' });
      expect(await balance()).toMatchObject({ availableTRY: '0.00', paidOutTRY: '50.00', pendingTRY: '0.00' });
      expect(payer.built).toHaveLength(1);
      expect(anchor.calls.find((c) => c.method === 'PUT')!.form).toEqual({ bank_account_number: IBAN });
      const me = await t.prisma.merchant.findFirstOrThrow();
      expect(me).toMatchObject({ sep12CustomerId: 'cus_1', sep12Iban: IBAN, sep12HomeDomain: FAKE_DOMAIN });
    });

    it('the anchor rejects the amount → the settlement stays pending (never failed), reason recorded internally only', async () => {
      await boot(sep6());
      await setIban();
      anchor.minUSDC = '1000';
      const link = await newLink();
      await pay(link.code);
      await svc().runJob();

      const [s] = (await settlements()).items;
      expect(s.status).toBe('pending');
      expect(s).not.toHaveProperty('blockedReason');
      expect((await t.prisma.settlement.findFirstOrThrow()).blockedReason).toBe('outside_anchor_limits');
      expect(await balance()).toMatchObject({ pendingTRY: '5000.00', paidOutTRY: '0.00' });
      expect(payer.built).toHaveLength(0);

      anchor.minUSDC = '1'; // the anchor's limits change: the job carries on by itself
      await svc().runJob();
      expect((await settlements()).items[0]).toMatchObject({ status: 'completed', netTRY: '50.00' });
      expect((await t.prisma.settlement.findFirstOrThrow()).blockedReason).toBeNull();
    });

    it('no IBAN → pending (missing_iban); saving an IBAN lets the job finish it (acceptance scenario 29)', async () => {
      await boot(sep6());
      const link = await newLink();
      await pay(link.code);
      await svc().runJob();
      expect((await t.prisma.settlement.findFirstOrThrow()).blockedReason).toBe('missing_iban');
      await setIban();
      await svc().runJob();
      expect((await settlements()).items[0].status).toBe('completed');
    });

    it('anchor info states keep it processing with the reason recorded; it completes when the anchor moves on', async () => {
      await boot(sep6());
      await setIban();
      anchor.afterPayment = Array(500).fill('pending_customer_info_update');
      const link = await newLink();
      await pay(link.code);
      await waitFor('info state', () => t.prisma.settlement.findFirst(), (s) => s?.blockedReason === 'pending_customer_info_update');
      expect((await settlements()).items[0].status).toBe('processing');

      for (const tx of anchor.txs.values()) tx.script = ['pending_anchor', 'completed'];
      await svc().runJob();
      expect((await settlements()).items[0]).toMatchObject({ status: 'completed', netTRY: '50.00' });
      expect((await t.prisma.settlement.findFirstOrThrow()).blockedReason).toBeNull();
    });

    it('retry after a failure: the payment submission fails, the job resubmits the same transaction — one payment', async () => {
      await boot(sep6());
      await setIban();
      payer.failSubmit = new Error('Horizon 504 Gateway Timeout');
      const link = await newLink();
      await pay(link.code);
      await waitFor('stored payment', () => t.prisma.settlement.findFirst(), (s) => s?.paymentTxHash !== null && s?.paymentTxHash !== undefined);
      await svc().runJob();

      const s = await t.prisma.settlement.findFirstOrThrow();
      expect(s.status).toBe('completed');
      expect(payer.built).toHaveLength(1);
      expect(payer.submitted).toHaveLength(2);
      expect(new Set(payer.submitted).size).toBe(1); // the same signed XDR both times
    });

    it('an anchor failure status fails the settlement (terminal, not retried)', async () => {
      await boot(sep6());
      await setIban();
      anchor.afterPayment = ['error'];
      const link = await newLink();
      await pay(link.code);
      const [s] = (await settled('failed')).items;
      expect(s).toMatchObject({ failReason: 'anchor_status', netTRY: null });
      await svc().runJob();
      expect(anchor.calls.filter((c) => c.path === '/sep6/withdraw')).toHaveLength(1);
    });
  });

  describe('idempotency and the guarantee job', () => {
    it('a link never settles twice: event, job and replays all land on one settlement and one anchor payment', async () => {
      await boot(sep6());
      await setIban();
      const link = await newLink();
      const r = await pay(link.code);
      const events = t.app.get(PaymentEvents);
      events.emitPaymentDetected({ linkId: link.id, txHash: r.transaction_hash as string }); // duplicate event
      await Promise.all([svc().runJob(), svc().runJob(), svc().settleLink(link.id), svc().settleLink(link.id)]);
      await settled();
      await svc().runJob();

      expect(await t.prisma.settlement.count()).toBe(1);
      expect(anchor.calls.filter((c) => c.path === '/sep6/withdraw')).toHaveLength(1);
      expect(payer.built).toHaveLength(1);
    });

    it('the job catches a paid link whose event was lost (crash between payment and settlement)', async () => {
      await boot();
      t.app.get(PaymentEvents).removeAllListeners(PAYMENT_DETECTED); // the event never reaches settlement
      const link = await newLink();
      await pay(link.code);
      expect((await t.http().get(`/api/links/${link.id}`).set(auth)).body.status).toBe('paid');
      expect(await t.prisma.settlement.count()).toBe(0);

      await svc().runJob();
      const [s] = (await settled()).items;
      expect(s).toMatchObject({ amountTRY: '5000.00', netTRY: '5000.00' });
    });

    it('an underpaid link settles once, on the payment that completed it', async () => {
      await boot();
      const link = await newLink();
      await pay(link.code, '100.0000000');
      await svc().runJob();
      expect(await t.prisma.settlement.count()).toBe(0); // underpaid: nothing to settle yet
      const done = await pay(link.code, '47.0588236');
      const [s] = (await settled()).items;
      const completing = await t.prisma.payment.findUniqueOrThrow({ where: { txHash: done.transaction_hash as string } });
      expect(s.paymentId).toBe(completing.id);
      const payments = (await t.http().get('/api/payments').set(auth)).body.items;
      expect(payments.map((p: { settlement: unknown }) => p.settlement === null)).toEqual([false, true]); // newest first
    });

    it('a settlement continues on the provider it was created with (no sep24 adapter → stays pending)', async () => {
      await boot({ env: { ANCHOR_PROVIDER: 'sep24', ANCHOR_HOME_DOMAIN: FAKE_DOMAIN }, adapters: () => [new MockAnchorAdapter(0)] });
      const link = await newLink();
      await pay(link.code);
      await svc().runJob();
      expect((await settlements()).items[0]).toMatchObject({ provider: 'sep24', status: 'pending' });
    });
  });
});
