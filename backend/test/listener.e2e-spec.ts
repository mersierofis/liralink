import { AppConfig } from '../src/config/app-config';
import { toInboundOp } from '../src/listener/inbound-op';
import { PaymentProcessor } from '../src/listener/payment-processor';
import { FakePaymentSource, createTestApp, registerMerchant, resetDb, type TestApp } from './helpers';

const CIRCLE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const IMPOSTOR = 'GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6';
const PAYER = 'GDKC65WHV2UPVEUDG4ZPCJEHIW3C7KXOSZ4TV2O3GIHVDWUHVKOF26RL';
const QUOTED = '147.0588236'; // 5000.00 TRY at 34.00, rounded up

let seq = 0;
/**
 * A Horizon payments record exactly as the SDK hands it over with .join('transactions'): the
 * transaction in `transaction_attr`, its linked `ledger` a function and the number in `ledger_attr`.
 */
function record(
  platform: string,
  p: { code?: string | null; amount?: string; asset?: 'usdc' | 'xlm' | 'spoof'; tx?: string; paidAt?: Date; from?: string; to?: string },
): Record<string, unknown> {
  seq++;
  const token = String(9_000_000_000 + seq);
  const asset =
    p.asset === 'xlm'
      ? { asset_type: 'native' }
      : { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: p.asset === 'spoof' ? IMPOSTOR : CIRCLE };
  const code = p.code === undefined ? null : p.code;
  const createdAt = (p.paidAt ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const txHash = (p.tx ?? `tx${seq}`).padEnd(64, '0');
  return {
    id: token,
    paging_token: token,
    type: 'payment',
    transaction_successful: true,
    created_at: createdAt,
    transaction_hash: txHash,
    from: p.from ?? PAYER,
    to: p.to ?? platform,
    amount: p.amount ?? QUOTED,
    ...asset,
    transaction_attr: {
      hash: txHash,
      ledger: () => undefined,
      ledger_attr: 4_759_000 + seq,
      created_at: createdAt,
      successful: true,
      memo_type: code === null ? 'none' : 'text',
      memo_bytes: code === null ? null : Buffer.from(code).toString('base64'),
      memo: code,
    },
  };
}

describe('Horizon payment listener (e2e)', () => {
  let t: TestApp;
  let platform: string;
  let auth: { Authorization: string };

  async function boot(source = new FakePaymentSource(), reset = true): Promise<void> {
    t = await createTestApp(source);
    platform = t.app.get(AppConfig).platformAccount;
    if (reset) {
      await resetDb(t.prisma);
      await t.listener.connect(); // fresh cursor for the fresh database
      await t.listener.idle();
    }
    if (!reset) return; // a restart: same database, same merchant, same token
    const { token } = await registerMerchant(t);
    auth = { Authorization: `Bearer ${token}` };
  }

  afterEach(() => t?.close());

  const newLink = async () => (await t.http().post('/api/links').set(auth).send({ title: 'Lemon order #1042', amountTRY: '5000.00' }).expect(201)).body;
  const pay = async (p: Parameters<typeof record>[1]) => {
    const r = record(platform, p);
    t.source.push(r);
    await t.listener.idle();
    return r;
  };
  const getLink = async (id: string) => (await t.http().get(`/api/links/${id}`).set(auth).expect(200)).body;
  const me = async () => (await t.http().get('/api/me').set(auth).expect(200)).body;

  describe('exact-amount policy', () => {
    beforeEach(() => boot());

    it('received == quotedUSDC → paid, one Payment with the payer, amount, ledger and explorer link', async () => {
      const link = await newLink();
      const r = await pay({ code: link.code, amount: QUOTED });

      const after = await getLink(link.id);
      expect(after).toMatchObject({ status: 'paid', receivedUSDC: QUOTED });
      expect(after).not.toHaveProperty('shortfallUSDC');
      expect(after.payments).toHaveLength(1);
      expect(after.payment).toMatchObject({
        rail: 'memo',
        txHash: r.transaction_hash,
        payerAddress: PAYER,
        amountUSDC: QUOTED,
        ledger: (r.transaction_attr as { ledger_attr: number }).ledger_attr,
        explorerUrl: `https://stellar.expert/explorer/testnet/tx/${r.transaction_hash}`,
      });
      expect((await me()).unallocatedUSDC).toBe('0.0000000');
    });

    it('received < quotedUSDC → underpaid, stays payable, shortfall shown to merchant and payer', async () => {
      const link = await newLink();
      await pay({ code: link.code, amount: '100.0000000' });

      expect(await getLink(link.id)).toMatchObject({ status: 'underpaid', receivedUSDC: '100.0000000', shortfallUSDC: '47.0588236' });
      expect((await t.http().get(`/api/pay/${link.code}`)).body).toMatchObject({ status: 'underpaid', shortfallUSDC: '47.0588236' });
    });

    it('an underpaid link is completed by a second payment: two Payment rows, paid', async () => {
      const link = await newLink();
      const first = await pay({ code: link.code, amount: '100.0000000' });
      const second = await pay({ code: link.code, amount: '47.0588236' });

      const after = await getLink(link.id);
      expect(after).toMatchObject({ status: 'paid', receivedUSDC: QUOTED });
      expect(after).not.toHaveProperty('shortfallUSDC');
      expect(after.payments.map((p: { txHash: string; amountUSDC: string }) => [p.txHash, p.amountUSDC])).toEqual([
        [first.transaction_hash, '100.0000000'],
        [second.transaction_hash, '47.0588236'],
      ]);
      expect(after.payment.txHash).toBe(second.transaction_hash);
    });

    it('received > quotedUSDC → paid, the excess credited to merchant.unallocatedUSDC', async () => {
      const link = await newLink();
      const r = await pay({ code: link.code, amount: '150.0000000' });

      expect(await getLink(link.id)).toMatchObject({ status: 'paid', receivedUSDC: '150.0000000' });
      expect((await me()).unallocatedUSDC).toBe('2.9411764');
      const credits = await t.prisma.unallocatedCredit.findMany();
      expect(credits).toHaveLength(1);
      expect(credits[0]).toMatchObject({ source: 'overpaid', txHash: r.transaction_hash, linkCode: link.code });
      expect(credits[0].amountUSDC.toFixed()).toBe('2.9411764');
    });

    it('a top-up that overshoots an underpaid link credits only the overshoot', async () => {
      const link = await newLink();
      await pay({ code: link.code, amount: '100.0000000' });
      await pay({ code: link.code, amount: '50.0000000' });
      expect(await getLink(link.id)).toMatchObject({ status: 'paid', receivedUSDC: '150.0000000' });
      expect((await me()).unallocatedUSDC).toBe('2.9411764');
    });
  });

  describe('never dropped: PaymentAttempt with the right reason', () => {
    beforeEach(() => boot());

    const attempts = () => t.prisma.paymentAttempt.findMany({ orderBy: { createdAt: 'asc' } });

    it.each(['paid', 'cancelled'] as const)('%s link → link_not_open, credited in full to unallocatedUSDC as stray', async (state) => {
      const link = await newLink();
      if (state === 'paid') await pay({ code: link.code, amount: QUOTED });
      else await t.http().post(`/api/links/${link.id}/cancel`).set(auth).expect(200);

      const r = await pay({ code: link.code, amount: '10.0000000' });

      const [a] = (await attempts()).filter((x) => x.txHash === r.transaction_hash);
      expect(a).toMatchObject({ reason: 'link_not_open', linkCode: link.code, assetCode: 'USDC', assetIssuer: CIRCLE });
      expect(a.merchantId).toBe(link.merchantId);
      expect(a.amount.toFixed()).toBe('10');
      expect((await me()).unallocatedUSDC).toBe('10.0000000');
      const stray = await t.prisma.unallocatedCredit.findFirstOrThrow({ where: { source: 'stray' } });
      expect(stray).toMatchObject({ txHash: r.transaction_hash, linkCode: link.code });
      expect((await getLink(link.id)).payments).toHaveLength(state === 'paid' ? 1 : 0);
    });

    it('no link has the code → link_not_found, nothing credited to anyone', async () => {
      await pay({ code: 'ZZZZZZZZ', amount: '10.0000000' });
      const [a] = await attempts();
      expect(a).toMatchObject({ reason: 'link_not_found', linkCode: 'ZZZZZZZZ', merchantId: null });
      expect(await t.prisma.unallocatedCredit.count()).toBe(0);
      expect(await t.prisma.payment.count()).toBe(0);
    });

    it('USDC without a link-code memo → unmatched_memo, nothing credited', async () => {
      await pay({ code: null, amount: '10.0000000' });
      await pay({ code: 'invoice #1042', amount: '5.0000000' });
      expect((await attempts()).map((a) => [a.reason, a.linkCode, a.merchantId])).toEqual([
        ['unmatched_memo', null, null],
        ['unmatched_memo', null, null],
      ]);
      expect(await t.prisma.unallocatedCredit.count()).toBe(0);
    });

    it('XLM with a valid memo → wrong_asset (XLM, no issuer); the link is untouched, nothing credited', async () => {
      const link = await newLink();
      await pay({ code: link.code, amount: '1000.0000000', asset: 'xlm' });

      const [a] = await attempts();
      expect(a).toMatchObject({ reason: 'wrong_asset', assetCode: 'XLM', assetIssuer: null, linkCode: link.code, merchantId: link.merchantId });
      expect(a.amount.toFixed()).toBe('1000');
      expect(await getLink(link.id)).toMatchObject({ status: 'open', receivedUSDC: '0.0000000', payments: [] });
      expect((await me()).unallocatedUSDC).toBe('0.0000000');
    });

    it('spoofed USDC (code USDC, another issuer) → wrong_asset with the impostor recorded; the link is untouched', async () => {
      const link = await newLink();
      await pay({ code: link.code, amount: QUOTED, asset: 'spoof' });

      const [a] = await attempts();
      expect(a).toMatchObject({ reason: 'wrong_asset', assetCode: 'USDC', assetIssuer: IMPOSTOR, linkCode: link.code });
      expect(await getLink(link.id)).toMatchObject({ status: 'open', receivedUSDC: '0.0000000', payments: [] });
      expect((await me()).unallocatedUSDC).toBe('0.0000000');
    });

    it('outgoing payments from the platform are skipped but still move the cursor', async () => {
      const r = await pay({ from: platform, to: PAYER, amount: '5.0000000' });
      expect(await attempts()).toHaveLength(0);
      expect(t.listener.status().cursor).toBe(r.paging_token);
      expect(await t.prisma.processedOperation.findUnique({ where: { opId: r.id as string } })).toMatchObject({ outcome: 'ignored:outgoing' });
    });
  });

  describe('expiry: only a link with no payments expires, judged by payment time', () => {
    beforeEach(() => boot());
    const setExpiry = (id: string, expiresAt: Date) => t.prisma.paymentLink.update({ where: { id }, data: { expiresAt } });

    it('an open link paid after expiresAt → stray, and the link becomes expired', async () => {
      const link = await newLink();
      await setExpiry(link.id, new Date(Date.now() - 60_000));
      await pay({ code: link.code, paidAt: new Date() });
      expect((await getLink(link.id)).status).toBe('expired');
      expect((await t.prisma.paymentAttempt.findFirstOrThrow()).reason).toBe('link_not_open');
      expect((await me()).unallocatedUSDC).toBe(QUOTED);
    });

    it('a payment made before expiresAt counts even if the link was expired on read meanwhile', async () => {
      const link = await newLink();
      const expiresAt = new Date(Date.now() - 60_000);
      await setExpiry(link.id, expiresAt);
      expect((await getLink(link.id)).status).toBe('expired'); // expired on read while the listener lagged
      await pay({ code: link.code, paidAt: new Date(expiresAt.getTime() - 1000) });
      expect(await getLink(link.id)).toMatchObject({ status: 'paid', receivedUSDC: QUOTED });
    });

    it('an underpaid link never expires: a top-up long after expiresAt completes it', async () => {
      const link = await newLink();
      await pay({ code: link.code, amount: '100.0000000' });
      await setExpiry(link.id, new Date(Date.now() - 86_400_000));
      expect((await getLink(link.id)).status).toBe('underpaid'); // expire-on-read leaves it alone
      await pay({ code: link.code, amount: '47.0588236' });
      expect(await getLink(link.id)).toMatchObject({ status: 'paid', receivedUSDC: QUOTED });
    });
  });

  describe('idempotency', () => {
    beforeEach(() => boot());

    it('the same operation delivered twice by the stream creates one Payment', async () => {
      const link = await newLink();
      const r = await pay({ code: link.code, amount: '100.0000000' });
      t.source.replay(r);
      await t.listener.idle();
      expect(await t.prisma.payment.count()).toBe(1);
      expect((await getLink(link.id)).receivedUSDC).toBe('100.0000000');
    });

    it('re-reading from an old cursor (lost cursor, catch-up overlap) changes nothing', async () => {
      const link = await newLink();
      await pay({ code: link.code, amount: '100.0000000' });
      await pay({ code: 'ZZZZZZZZ', amount: '1.0000000' });
      const before = { payments: await t.prisma.payment.count(), attempts: await t.prisma.paymentAttempt.count() };

      await t.prisma.listenerCursor.updateMany({ data: { pagingToken: '0' } });
      await t.listener.connect(); // resumes from 0: every record comes back through the processor
      await t.listener.idle();

      expect({ payments: await t.prisma.payment.count(), attempts: await t.prisma.paymentAttempt.count() }).toEqual(before);
      expect((await getLink(link.id)).receivedUSDC).toBe('100.0000000');
    });

    it('the processor itself answers "duplicate" for an operation it has seen', async () => {
      const link = await newLink();
      const r = await pay({ code: link.code });
      expect(await t.app.get(PaymentProcessor).process(toInboundOp(r))).toEqual({ outcome: 'duplicate' });
    });

    it('two operations of one transaction make one Payment, not two', async () => {
      const link = await newLink();
      await pay({ code: link.code, amount: '100.0000000', tx: 'samehash' });
      await pay({ code: link.code, amount: '47.0588236', tx: 'samehash' });

      const after = await getLink(link.id);
      expect(after.status).toBe('paid');
      expect(after.payments).toHaveLength(1);
      expect(after.payment.amountUSDC).toBe(QUOTED);
    });
  });

  describe('cursor and restart', () => {
    it('first start begins at the newest existing record and persists it (older history is not replayed)', async () => {
      const source = new FakePaymentSource();
      source.records.push(record('GXXX', { code: 'OLDOLD22' }));
      await boot(source);
      expect(t.listener.status().cursor).toBe(source.records[0].paging_token);
      expect(await t.prisma.processedOperation.count()).toBe(0);
    });

    it('a restart resumes from the saved cursor: nothing replayed, nothing skipped', async () => {
      const source = new FakePaymentSource();
      await boot(source);
      const link = await newLink();
      await pay({ code: link.code, amount: '50.0000000' });
      const r2 = await pay({ code: link.code, amount: '50.0000000' });
      await t.close();

      // While the API was down, two more payments landed on the ledger.
      source.records.push(record(platform, { code: link.code, amount: '40.0000000' }));
      const r4 = record(platform, { code: link.code, amount: '7.0588236' });
      source.records.push(r4);
      source.pageCalls.length = 0;
      source.streamCursors.length = 0;

      await boot(source, false);
      expect(source.pageCalls[0]).toBe(r2.paging_token); // resumed exactly after the last committed op
      expect(source.streamCursors).toEqual([r4.paging_token]); // then streams from the newest
      expect(await t.prisma.processedOperation.count()).toBe(4);
      expect(await t.prisma.payment.count()).toBe(4);
      expect(await getLink(link.id)).toMatchObject({ status: 'paid', receivedUSDC: QUOTED });
    });

    it('a failing operation stops the listener at its cursor: later operations wait, none is skipped', async () => {
      await boot();
      const link = await newLink();
      const ok = await pay({ code: link.code, amount: '10.0000000' });
      await pay({ code: link.code, amount: '1e1' }); // malformed: never guessed
      await pay({ code: link.code, amount: '10.0000000' });

      expect(t.listener.status()).toEqual({ state: 'stopped', cursor: ok.paging_token });
      expect((await t.prisma.listenerCursor.findFirstOrThrow()).pagingToken).toBe(ok.paging_token);
      expect(await t.prisma.payment.count()).toBe(1);
    });
  });

  describe('/health', () => {
    it('reports the listener running and its cursor position', async () => {
      await boot();
      const link = await newLink();
      const r = await pay({ code: link.code });
      expect((await t.http().get('/api/health').expect(200)).body).toMatchObject({
        listener: 'running',
        listenerCursor: r.paging_token,
      });
    });
  });
});
