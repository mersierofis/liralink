import { AppConfig } from '../src/config/app-config';
import type { EventsFrom, InvoiceChain } from '../src/invoice/invoice-chain';
import type { PaidEvent } from '../src/invoice/invoice-contract';
import { QUOTED, PAYER, createTestApp, record, registerMerchant, resetDb, type TestApp } from './helpers';

const CONTRACT = 'CCXHJK4Y667EDKM5H3CXKP26V3LRVOH6NULYS5K6T4BKQADSSFL23BIA';
const RAIL_ON = { INVOICE_CONTRACT_ID: CONTRACT, SOROBAN_RPC_URL: 'http://127.0.0.1:9', NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015' };
const TX = 'c'.repeat(64);

/** Invoices always land; `paid` events are served once each, like RPC after the cursor. */
class Chain implements InvoiceChain {
  readonly contractId = CONTRACT;
  pending: PaidEvent[] = [];
  reads = 0;
  async create() {
    return { txHash: 'd'.repeat(64), deadlineLedger: 1_200_000 };
  }
  async cancel() {
    return 'e'.repeat(64);
  }
  async paidEvents(_from: EventsFrom) {
    this.reads++;
    const events = this.pending;
    this.pending = [];
    return { events, cursor: `c${this.reads}`, more: false };
  }
}

describe('Payer status and submitted hint (e2e)', () => {
  let t: TestApp;
  let chain: Chain;
  let platform: string;
  let auth: { Authorization: string };

  beforeEach(async () => {
    chain = new Chain();
    t = await createTestApp(undefined, { env: RAIL_ON, invoiceChain: chain });
    platform = t.app.get(AppConfig).platformAccount;
    await resetDb(t.prisma);
    await t.listener.connect();
    await t.listener.idle();
    auth = { Authorization: `Bearer ${(await registerMerchant(t)).token}` };
  });
  afterEach(() => t?.close());

  const newLink = async () => (await t.http().post('/api/links').set(auth).send({ title: 'Lemon order #1042', amountTRY: '5000.00' }).expect(201)).body;
  const status = async (code: string) => (await t.http().get(`/api/pay/${code}/status`).expect(200)).body;

  describe('GET /pay/:code/status', () => {
    it('an open link: status, nothing received, no payments', async () => {
      const link = await newLink();
      expect(await status(link.code)).toEqual({ status: 'open', receivedUSDC: '0.0000000', payments: [] });
    });

    it('is case-insensitive and 404s an unknown code', async () => {
      const link = await newLink();
      expect((await status(link.code.toLowerCase())).status).toBe('open');
      await t.http().get('/api/pay/ZZZZZZZZ/status').expect(404);
    });

    it('underpaid shows the shortfall; paid shows the payment with its tx hash and explorer link', async () => {
      const link = await newLink();
      const first = record(platform, { code: link.code, amount: '100.0000000' });
      t.source.push(first);
      await t.listener.idle();
      expect(await status(link.code)).toMatchObject({ status: 'underpaid', receivedUSDC: '100.0000000', shortfallUSDC: '47.0588236' });

      const second = record(platform, { code: link.code, amount: '47.0588236' });
      t.source.push(second);
      await t.listener.idle();
      const s = await status(link.code);
      expect(s).toMatchObject({ status: 'paid', receivedUSDC: QUOTED });
      expect(s).not.toHaveProperty('shortfallUSDC');
      expect(s.payments).toHaveLength(2);
      expect(s.payment).toMatchObject({
        rail: 'memo',
        txHash: second.transaction_hash,
        explorerUrl: `https://stellar.expert/explorer/testnet/tx/${second.transaction_hash}`,
      });
    });

    it('a contract payment reaches the payer as paid with rail contract and its tx hash', async () => {
      const link = await newLink();
      chain.pending.push({ eventId: 'ev-1', txHash: TX, ledger: 1_100_001, paidAt: new Date(), code: link.code, payer: PAYER, merchant: platform, amountUSDC: QUOTED });
      await t.http().post(`/api/pay/${link.code}/submitted`).send({ txHash: TX }).expect(202);
      await new Promise((r) => setTimeout(r, 200));
      expect(await status(link.code)).toMatchObject({ status: 'paid', receivedUSDC: QUOTED, payment: { rail: 'contract', txHash: TX, payerAddress: PAYER } });
    });
  });

  describe('POST /pay/:code/submitted', () => {
    it('202 { accepted: true }, and it makes the contract watcher look now', async () => {
      const link = await newLink();
      const before = chain.reads;
      expect((await t.http().post(`/api/pay/${link.code}/submitted`).send({ txHash: TX }).expect(202)).body).toEqual({ accepted: true });
      await new Promise((r) => setTimeout(r, 100));
      expect(chain.reads).toBe(before + 1);
    });

    it('is throttled: a burst of hints makes one extra read', async () => {
      const link = await newLink();
      const before = chain.reads;
      for (let i = 0; i < 5; i++) await t.http().post(`/api/pay/${link.code}/submitted`).send({ txHash: TX }).expect(202);
      await new Promise((r) => setTimeout(r, 100));
      expect(chain.reads).toBe(before + 1);
    });

    it('400 without a 64-hex txHash; 404 for an unknown code', async () => {
      const link = await newLink();
      await t.http().post(`/api/pay/${link.code}/submitted`).send({}).expect(400);
      await t.http().post(`/api/pay/${link.code}/submitted`).send({ txHash: 'not-a-hash' }).expect(400);
      await t.http().post('/api/pay/ZZZZZZZZ/submitted').send({ txHash: TX }).expect(404);
    });
  });
});
