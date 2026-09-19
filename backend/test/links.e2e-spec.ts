import { Keypair } from '@stellar/stellar-sdk';
import { createTestApp, registerMerchant, resetDb, type TestApp } from './helpers';

const HOUR = 3_600_000;
const LINK_KEYS = [
  'id', 'code', 'merchantId', 'merchantName', 'title', 'amountTRY', 'quotedUSDC', 'fxRate', 'quoteExpiresAt',
  'status', 'expiresAt', 'payUrl', 'receivedUSDC', 'payments', 'onchain', 'createdAt',
].sort();

describe('Payment links (e2e)', () => {
  let t: TestApp;
  let token: string;
  let auth: { Authorization: string };

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    t.fx.rate = '34.00';
    t.fx.failure = null;
    ({ token } = await registerMerchant(t, { businessName: 'Erdemli Narenciye A.Ş.' }));
    auth = { Authorization: `Bearer ${token}` };
  });
  afterAll(() => t.close());

  const createLink = (body: Record<string, unknown> = {}) =>
    t.http().post('/api/links').set(auth).send({ title: 'Lemon order #1042', amountTRY: '5000.00', ...body });

  describe('POST /api/links', () => {
    it('201 with exactly the contract PaymentLink, quote locked from the current rate', async () => {
      const before = Date.now();
      const res = await createLink().expect(201);
      const link = res.body;

      expect(Object.keys(link).sort()).toEqual(LINK_KEYS); // no description, shortfall or payment: omitted
      expect(link).toMatchObject({
        merchantName: 'Erdemli Narenciye A.Ş.',
        title: 'Lemon order #1042',
        amountTRY: '5000.00',
        quotedUSDC: '147.0588236', // 5000 / 34 rounded UP to 7 dp
        fxRate: '34.0000000',
        status: 'open',
        receivedUSDC: '0.0000000',
        payments: [],
        onchain: null,
      });
      expect(link.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
      expect(link.payUrl).toBe(`http://localhost:5174/p/${link.code}`);
      expect(link.quoteExpiresAt).toBe(link.expiresAt);
      const expires = new Date(link.expiresAt).getTime();
      expect(expires).toBeGreaterThanOrEqual(before + 24 * HOUR); // LINK_DEFAULT_EXPIRY_HOURS
      expect(expires).toBeLessThanOrEqual(Date.now() + 24 * HOUR);
    });

    it('keeps description and honours expiresInHours', async () => {
      const res = await createLink({ description: '2 t Interdonato lemons', expiresInHours: 48 }).expect(201);
      expect(res.body.description).toBe('2 t Interdonato lemons');
      expect(new Date(res.body.expiresAt).getTime() - new Date(res.body.createdAt).getTime()).toBeGreaterThanOrEqual(48 * HOUR - 1000);
    });

    it.each([
      ['a number', 5000],
      ['no decimals', '5000'],
      ['one decimal', '5000.0'],
      ['three decimals', '5000.000'],
      ['below 1.00', '0.99'],
      ['above 1,000,000.00', '1000000.01'],
      ['exponent', '5e3'],
      ['negative', '-5.00'],
    ])('400 for amountTRY as %s', async (_, amountTRY) => {
      const res = await createLink({ amountTRY }).expect(400);
      expect(res.body.message).toEqual(expect.arrayContaining([expect.stringContaining('amountTRY')]));
    });

    it.each([[0], [1.5], ['24']])('400 for expiresInHours %j', async (expiresInHours) => {
      await createLink({ expiresInHours }).expect(400);
    });

    it('400 without a title', async () => {
      await t.http().post('/api/links').set(auth).send({ amountTRY: '10.00' }).expect(400);
    });

    it('401 without a token', async () => {
      await t.http().post('/api/links').send({ title: 'x', amountTRY: '10.00' }).expect(401);
    });
  });

  describe('quote locking', () => {
    it('amountTRY and quotedUSDC never follow a later rate, on any read path', async () => {
      const created = (await createLink().expect(201)).body;
      t.fx.rate = '41.25';

      const byId = (await t.http().get(`/api/links/${created.id}`).set(auth).expect(200)).body;
      const listed = (await t.http().get('/api/links').set(auth).expect(200)).body.items[0];
      const byCode = (await t.http().get(`/api/pay/${created.code}`).expect(200)).body;

      for (const l of [byId, listed]) {
        expect(l).toMatchObject({ amountTRY: '5000.00', quotedUSDC: '147.0588236', fxRate: '34.0000000' });
      }
      expect(byCode).toMatchObject({ amountTRY: '5000.00', amountUSDC: '147.0588236', fxRate: '34.0000000' });
      expect(byCode.quoteExpiresAt).toBe(created.quoteExpiresAt);

      const later = (await createLink().expect(201)).body;
      expect(later.quotedUSDC).toBe('121.2121213'); // 5000 / 41.25 = 121.21212121… rounded up
    });
  });

  describe('FX rate', () => {
    it('stores what was quoted and when, without adding fields to the API response', async () => {
      t.fx.rate = '48.540000';
      t.fx.midRate = '48.785077';
      t.fx.spread = '0.0050237';
      const link = (await createLink().expect(201)).body;

      expect(Object.keys(link).sort()).toEqual(LINK_KEYS); // the contract has no fields for these yet
      expect(link).toMatchObject({ quotedUSDC: '103.0078286', fxRate: '48.5400000' });

      const row = await t.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
      expect(row.fxSource).toBe('anchor');
      expect(row.fxRateAt.toISOString()).toBe('2026-09-19T10:00:00.000Z');
      expect(row.fxMidRate.toFixed()).toBe('48.785077');
      expect(row.fxSpread?.toFixed()).toBe('0.0050237');
      expect(row.fxQuoteRaw).toEqual({ total_price: 'recorded', note: 'test double' });
    });

    it('503 ApiError and no link when the rate cannot be fetched — never a stale or guessed rate', async () => {
      await createLink().expect(201); // a good rate was seen before
      t.fx.failure = 'anchor /price answered HTTP 502';

      const res = await createLink().expect(503);
      expect(res.body).toEqual({
        statusCode: 503,
        message: 'FX rate unavailable, no link created: anchor /price answered HTTP 502',
        error: 'Service Unavailable',
      });
      expect(await t.prisma.paymentLink.count()).toBe(1);

      t.fx.failure = null;
      await createLink().expect(201); // recovers as soon as the source does
    });
  });

  describe('GET /api/links', () => {
    it('paginates newest first: page from 1, limit default 20', async () => {
      for (let i = 1; i <= 23; i++) await createLink({ title: `order ${i}` }).expect(201);

      const first = (await t.http().get('/api/links').set(auth).expect(200)).body;
      expect(first.total).toBe(23);
      expect(first.items).toHaveLength(20);
      expect(first.items[0].title).toBe('order 23');

      const second = (await t.http().get('/api/links?page=2').set(auth).expect(200)).body;
      expect(second.items.map((l: { title: string }) => l.title)).toEqual(['order 3', 'order 2', 'order 1']);

      const small = (await t.http().get('/api/links?page=3&limit=5').set(auth).expect(200)).body;
      expect(small.items.map((l: { title: string }) => l.title)).toEqual(['order 13', 'order 12', 'order 11', 'order 10', 'order 9']);
      expect((await t.http().get('/api/links?page=9').set(auth).expect(200)).body).toEqual({ items: [], total: 23 });
    });

    it.each(['page=0', 'page=-1', 'page=abc', 'limit=0', 'limit=101', 'limit=2.5', 'status=unknown'])(
      '400 for ?%s',
      async (q) => {
        await t.http().get(`/api/links?${q}`).set(auth).expect(400);
      },
    );

    it('accepts limit=100', async () => {
      await t.http().get('/api/links?limit=100').set(auth).expect(200);
    });

    it('filters by status and only ever lists the caller’s own links', async () => {
      const a = (await createLink({ title: 'a' })).body;
      await createLink({ title: 'b' });
      await t.http().post(`/api/links/${a.id}/cancel`).set(auth).expect(200);
      const other = await registerMerchant(t);
      await t.http().post('/api/links').set('Authorization', `Bearer ${other.token}`).send({ title: 'theirs', amountTRY: '1.00' });

      const cancelled = (await t.http().get('/api/links?status=cancelled').set(auth).expect(200)).body;
      expect(cancelled.total).toBe(1);
      expect(cancelled.items[0].title).toBe('a');
      const all = (await t.http().get('/api/links').set(auth).expect(200)).body;
      expect(all.items.map((l: { title: string }) => l.title)).toEqual(['b', 'a']);
    });
  });

  describe('GET /api/links/:id', () => {
    it('200 for the owner, 404 for anyone else and for a malformed id', async () => {
      const link = (await createLink()).body;
      await t.http().get(`/api/links/${link.id}`).set(auth).expect(200);

      const other = await registerMerchant(t);
      const res = await t.http().get(`/api/links/${link.id}`).set('Authorization', `Bearer ${other.token}`).expect(404);
      expect(res.body).toEqual({ statusCode: 404, message: 'Link not found', error: 'Not Found' });
      await t.http().get('/api/links/not-a-uuid').set(auth).expect(404);
      await t.http().get('/api/links/00000000-0000-4000-8000-000000000000').set(auth).expect(404);
    });
  });

  describe('POST /api/links/:id/cancel', () => {
    it('200 cancels an open link; 409 once it is no longer open', async () => {
      const link = (await createLink()).body;
      const res = await t.http().post(`/api/links/${link.id}/cancel`).set(auth).expect(200);
      expect(res.body.status).toBe('cancelled');
      expect(res.body.quotedUSDC).toBe(link.quotedUSDC);

      const again = await t.http().post(`/api/links/${link.id}/cancel`).set(auth).expect(409);
      expect(again.body).toEqual({
        statusCode: 409,
        message: 'Link is cancelled; only an open link can be cancelled',
        error: 'Conflict',
      });
    });

    it.each(['paid', 'underpaid', 'expired'] as const)('409 for a %s link', async (status) => {
      const link = (await createLink()).body;
      await t.prisma.paymentLink.update({ where: { id: link.id }, data: { status } });
      await t.http().post(`/api/links/${link.id}/cancel`).set(auth).expect(409);
    });

    it('404 for another merchant’s link, which stays open', async () => {
      const link = (await createLink()).body;
      const other = await registerMerchant(t);
      await t.http().post(`/api/links/${link.id}/cancel`).set('Authorization', `Bearer ${other.token}`).expect(404);
      expect((await t.http().get(`/api/links/${link.id}`).set(auth)).body.status).toBe('open');
    });
  });

  describe('GET /api/pay/:code (public)', () => {
    it('200 PayQuote without auth, case-insensitive, nothing merchant-private', async () => {
      const link = (await createLink({ description: 'Interdonato' })).body;
      const res = await t.http().get(`/api/pay/${link.code.toLowerCase()}`).expect(200);
      const q = res.body;

      expect(Object.keys(q).sort()).toEqual(
        [
          'code', 'merchantName', 'title', 'description', 'amountTRY', 'amountUSDC', 'fxRate', 'quoteExpiresAt',
          'status', 'expiresAt', 'receivedUSDC', 'rails', 'asset', 'network', 'payments',
        ].sort(),
      );
      expect(q).toMatchObject({
        code: link.code,
        merchantName: 'Erdemli Narenciye A.Ş.',
        amountTRY: '5000.00',
        amountUSDC: '147.0588236',
        status: 'open',
        receivedUSDC: '0.0000000',
        asset: { code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
        network: 'testnet',
        payments: [],
      });
      expect(q.rails).toEqual({ memo: { destination: expect.any(String), memo: link.code } });
      expect(Keypair.fromPublicKey(q.rails.memo.destination).publicKey()).toBe(q.rails.memo.destination);
      expect(JSON.stringify(q)).not.toMatch(/merchantId|iban|email/i);
    });

    it('404 for an unknown or malformed code', async () => {
      await t.http().get('/api/pay/ZZZZZZZZ').expect(404);
      await t.http().get('/api/pay/abc').expect(404);
    });
  });
});
