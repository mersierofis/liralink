import { AppConfig } from '../src/config/app-config';
import type { EventsFrom, InvoiceChain } from '../src/invoice/invoice-chain';
import { InvoiceContractService } from '../src/invoice/invoice-contract.service';
import type { PaidEvent } from '../src/invoice/invoice-contract';
import { InvoiceWatcher } from '../src/invoice/invoice-watcher.service';
import { PaymentProcessor } from '../src/listener/payment-processor';
import { toInboundOp } from '../src/listener/inbound-op';
import { SettlementsService } from '../src/settlements/settlements.service';
import { CIRCLE, PAYER, QUOTED, createTestApp, record, registerMerchant, resetDb, type TestApp } from './helpers';

const CONTRACT = 'CCXHJK4Y667EDKM5H3CXKP26V3LRVOH6NULYS5K6T4BKQADSSFL23BIA';
const RAIL_ON = { INVOICE_CONTRACT_ID: CONTRACT, SOROBAN_RPC_URL: 'http://127.0.0.1:9', NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015' };
const QUOTED_STROOPS = 1_470_588_236n;

/** Soroban RPC stand-in: records calls, can fail or hang, and serves `paid` events by cursor. */
class FakeInvoiceChain implements InvoiceChain {
  readonly contractId = CONTRACT;
  created: { code: string; amountStroops: bigint; expiresAt: Date }[] = [];
  cancelled: string[] = [];
  events: PaidEvent[] = [];
  eventReads: EventsFrom[] = [];
  /** 'fail' throws like an RPC error; a number delays the answer by that many ms. */
  createMode: 'ok' | 'fail' | number = 'ok';
  eventsFail = false;
  private tx = 0;
  /** Cursor handed out → how many events it had already covered. */
  private cursors = new Map<string, number>();

  async create(p: { code: string; amountStroops: bigint; expiresAt: Date }) {
    if (this.createMode === 'fail') throw new Error('Soroban RPC: 503 Service Unavailable');
    if (typeof this.createMode === 'number') await new Promise((r) => setTimeout(r, this.createMode as number));
    this.created.push(p);
    return { txHash: `create${++this.tx}`.padEnd(64, '0'), deadlineLedger: 1_200_000 };
  }
  async cancel(code: string) {
    this.cancelled.push(code);
    return `cancel${++this.tx}`.padEnd(64, '0');
  }
  async paidEvents(from: EventsFrom) {
    this.eventReads.push(from);
    if (this.eventsFail) throw new Error('Soroban RPC: socket hang up');
    const after = 'cursor' in from ? (this.cursors.get(from.cursor) ?? 0) : 0;
    const cursor = `c${this.events.length}`;
    this.cursors.set(cursor, this.events.length);
    return { events: this.events.slice(after), cursor, more: false };
  }
}

let n = 0;
function paid(code: string, over: Partial<PaidEvent> = {}): PaidEvent {
  n++;
  return {
    eventId: `000481556411595980${n}-0000000001`,
    txHash: `contracttx${n}`.padEnd(64, '0'),
    ledger: 1_100_000 + n,
    paidAt: new Date(),
    code,
    payer: PAYER,
    merchant: '', // set to the platform account by the caller
    amountUSDC: QUOTED,
    ...over,
  };
}

describe('Soroban contract rail (e2e)', () => {
  let t: TestApp;
  let chain: FakeInvoiceChain;
  let platform: string;
  let auth: { Authorization: string };

  async function boot(opts: { rail: boolean } = { rail: true }): Promise<void> {
    chain = new FakeInvoiceChain();
    t = await createTestApp(undefined, opts.rail ? { env: RAIL_ON, invoiceChain: chain } : {});
    platform = t.app.get(AppConfig).platformAccount;
    await resetDb(t.prisma);
    await t.listener.connect();
    await t.listener.idle();
    const { token } = await registerMerchant(t);
    auth = { Authorization: `Bearer ${token}` };
    await t.http().patch('/api/me').set(auth).send({ iban: 'TR330006100519786457841326' }).expect(200);
  }

  afterEach(() => t?.close());

  const newLink = async () => (await t.http().post('/api/links').set(auth).send({ title: 'Lemon order #1042', amountTRY: '5000.00' }).expect(201)).body;
  const getLink = async (id: string) => (await t.http().get(`/api/links/${id}`).set(auth).expect(200)).body;
  const quote = async (code: string) => (await t.http().get(`/api/pay/${code}`).expect(200)).body;
  const payOnChain = (code: string, over: Partial<PaidEvent> = {}) => t.app.get(PaymentProcessor).processContractPaid(paid(code, { merchant: platform, ...over }));
  const me = async () => (await t.http().get('/api/me').set(auth).expect(200)).body;

  describe('optional: the memo rail never depends on the contract', () => {
    it('INVOICE_CONTRACT_ID empty → links work on the memo rail alone, no contract rail offered', async () => {
      await boot({ rail: false });
      const link = await newLink();
      expect(link.onchain).toBeNull();
      const q = await quote(link.code);
      expect(q.rails).toEqual({ memo: { destination: platform, memo: link.code } });
      await t.http().post(`/api/links/${link.id}/onchain`).set(auth).expect(503);
    });

    it('the contract call fails → the link is still 201, memo rail only', async () => {
      await boot();
      chain.createMode = 'fail';
      const link = await newLink();
      expect(link.onchain).toBeNull();
      expect((await quote(link.code)).rails).toEqual({ memo: { destination: platform, memo: link.code } });
    });

    it('RPC is slow → POST /links answers within the budget on the memo rail; the invoice lands later', async () => {
      await boot();
      t.app.get(InvoiceContractService).budgetMs = 100;
      chain.createMode = 600;
      const started = Date.now();
      const link = await newLink();
      expect(Date.now() - started).toBeLessThan(500);
      expect(link.onchain).toBeNull();
      expect((await quote(link.code)).rails.contract).toBeUndefined();

      await new Promise((r) => setTimeout(r, 900));
      expect((await getLink(link.id)).onchain).toMatchObject({ contractId: CONTRACT, invoiceCode: link.code });
      expect((await quote(link.code)).rails.contract).toEqual({ contractId: CONTRACT, invoiceCode: link.code });
    });
  });

  describe('link creation registers the invoice', () => {
    beforeEach(() => boot());

    it('stores contract id, invoice code, deadline and tx hash; the pay quote offers both rails', async () => {
      const link = await newLink();
      expect(chain.created).toEqual([{ code: link.code, amountStroops: QUOTED_STROOPS, expiresAt: new Date(link.expiresAt) }]);
      expect(link.onchain).toEqual({ contractId: CONTRACT, invoiceCode: link.code, deadlineLedger: 1_200_000, txHash: expect.stringMatching(/^create/) });
      expect((await quote(link.code)).rails).toEqual({
        contract: { contractId: CONTRACT, invoiceCode: link.code },
        memo: { destination: platform, memo: link.code },
      });
    });

    it('POST /links/:id/onchain retries a failed invoice; 200 unchanged once on-chain; 409 once paid', async () => {
      chain.createMode = 'fail';
      const link = await newLink();
      chain.createMode = 'ok';
      const retried = (await t.http().post(`/api/links/${link.id}/onchain`).set(auth).expect(200)).body;
      expect(retried.onchain).toMatchObject({ contractId: CONTRACT, invoiceCode: link.code });
      await t.http().post(`/api/links/${link.id}/onchain`).set(auth).expect(200);
      expect(chain.created).toHaveLength(1);

      chain.createMode = 'fail';
      const other = await newLink();
      await payOnChain(other.code); // no invoice, but pretend: a paid link can never go on-chain
      await t.http().post(`/api/links/${other.id}/onchain`).set(auth).expect(409);
    });

    it('cancel also cancels the invoice on-chain, and the contract rail is withdrawn', async () => {
      const link = await newLink();
      await t.http().post(`/api/links/${link.id}/cancel`).set(auth).expect(200);
      await new Promise((r) => setTimeout(r, 50)); // best-effort, in the background
      expect(chain.cancelled).toEqual([link.code]);
      expect((await quote(link.code)).rails.contract).toBeUndefined();
    });
  });

  describe('a contract payment is credited like a memo payment', () => {
    beforeEach(() => boot());

    it('paid event → link paid, Payment rail contract with tx hash and payer, and the settlement follows', async () => {
      const link = await newLink();
      const event = paid(link.code, { merchant: platform });
      expect(await t.app.get(PaymentProcessor).processContractPaid(event)).toEqual({ outcome: 'payment:paid' });

      const after = await getLink(link.id);
      expect(after).toMatchObject({ status: 'paid', receivedUSDC: QUOTED });
      expect(after.payment).toMatchObject({ rail: 'contract', txHash: event.txHash, payerAddress: PAYER, amountUSDC: QUOTED, ledger: event.ledger });
      expect((await quote(link.code)).rails.contract).toBeUndefined();

      await t.app.get(SettlementsService).runJob();
      const settlements = (await t.http().get('/api/settlements').set(auth).expect(200)).body;
      expect(settlements.items).toHaveLength(1);
      expect(settlements.items[0]).toMatchObject({ paymentId: after.payment.id, amountTRY: '5000.00', amountUSDC: QUOTED, status: 'completed' });
    });

    it('a paid event for a cancelled link is a stray: credited to unallocated, never to the link', async () => {
      const link = await newLink();
      await t.http().post(`/api/links/${link.id}/cancel`).set(auth).expect(200);
      expect(await payOnChain(link.code)).toEqual({ outcome: 'stray' });
      expect(await getLink(link.id)).toMatchObject({ status: 'cancelled', receivedUSDC: '0.0000000', payments: [] });
      expect((await me()).unallocatedUSDC).toBe(QUOTED);
    });

    it('a payout to anything but the platform account is ignored', async () => {
      const link = await newLink();
      expect(await payOnChain(link.code, { merchant: CIRCLE })).toEqual({ outcome: 'ignored:contract payout is not the platform account' });
      expect(await getLink(link.id)).toMatchObject({ status: 'open', receivedUSDC: '0.0000000' });
    });

    it('an underpaid link is not offered the contract rail (the invoice would take the full amount again)', async () => {
      const link = await newLink();
      t.source.push(record(platform, { code: link.code, amount: '100.0000000' }));
      await t.listener.idle();
      expect((await getLink(link.id)).status).toBe('underpaid');
      expect((await quote(link.code)).rails.contract).toBeUndefined();
    });
  });

  describe('exactly once', () => {
    beforeEach(() => boot());

    it('the same event twice credits once', async () => {
      const link = await newLink();
      const event = paid(link.code, { merchant: platform });
      const processor = t.app.get(PaymentProcessor);
      expect((await processor.processContractPaid(event)).outcome).toBe('payment:paid');
      expect((await processor.processContractPaid(event)).outcome).toBe('duplicate');
      expect(await getLink(link.id)).toMatchObject({ receivedUSDC: QUOTED, payments: [expect.anything()] });
      expect((await me()).unallocatedUSDC).toBe('0.0000000');
    });

    it('another event for a transaction already credited is not credited again', async () => {
      const link = await newLink();
      const first = paid(link.code, { merchant: platform });
      await payOnChain(link.code, first);
      expect(await payOnChain(link.code, { ...first, eventId: 'another-event-id' })).toEqual({ outcome: 'duplicate' });
      expect(await getLink(link.id)).toMatchObject({ receivedUSDC: QUOTED, payments: [expect.anything()] });
    });

    it('the Horizon listener sees the same transfer as invoke_host_function and ignores it', async () => {
      const link = await newLink();
      const event = paid(link.code, { merchant: platform });
      await payOnChain(link.code, event);
      // Horizon lists the SAC transfer on the platform account's payments as the contract call.
      const r = { ...record(platform, { code: null, tx: event.txHash }), type: 'invoke_host_function' };
      t.source.push(r);
      await t.listener.idle();
      expect(await t.prisma.processedOperation.findUnique({ where: { opId: toInboundOp(r).opId } })).toMatchObject({ outcome: 'ignored:type invoke_host_function' });
      expect(await getLink(link.id)).toMatchObject({ receivedUSDC: QUOTED, payments: [expect.anything()] });
      expect(await t.prisma.paymentAttempt.count()).toBe(0);
      expect((await me()).unallocatedUSDC).toBe('0.0000000');
    });
  });

  describe('the watcher', () => {
    beforeEach(() => boot());

    it('credits each paid event once and resumes from its saved cursor', async () => {
      const link = await newLink();
      chain.events.push(paid(link.code, { merchant: platform }));
      const watcher = t.app.get(InvoiceWatcher);
      await watcher.poll();
      expect((await getLink(link.id)).status).toBe('paid');
      await watcher.poll();
      expect(chain.eventReads).toEqual([{ fromOldestRetained: true }, { cursor: 'c1' }]);
      expect(await t.prisma.listenerCursor.findUnique({ where: { stream: `soroban-invoice:${CONTRACT}` } })).toMatchObject({ pagingToken: 'c1' });
      expect(await getLink(link.id)).toMatchObject({ receivedUSDC: QUOTED, payments: [expect.anything()] });
    });

    it('an RPC failure is logged, not thrown; the next poll picks up from the same cursor', async () => {
      const link = await newLink();
      chain.events.push(paid(link.code, { merchant: platform }));
      chain.eventsFail = true;
      await expect(t.app.get(InvoiceWatcher).poll()).resolves.toBeUndefined();
      expect((await getLink(link.id)).status).toBe('open');
      chain.eventsFail = false;
      await t.app.get(InvoiceWatcher).poll();
      expect((await getLink(link.id)).status).toBe('paid');
    });
  });
});
