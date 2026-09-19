import { AppConfig } from '../src/config/app-config';
import type { InboundOp } from '../src/payments/payment-matcher';
import { memoBytesForCode } from '../src/payments/payment-matcher';
import { PaymentsService } from '../src/payments/payments.service';
import { createTestApp, registerMerchant, resetDb, type TestApp } from './helpers';

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const SPOOF = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const PAYER = 'GBRZSG7K6ZXJRCMYM2O2HO2DKR7RO2ACZ5FARBMQZBB4YZMDFDXFUTV7';

function op(
  platform: string,
  code: string,
  partial: Partial<InboundOp> & Pick<InboundOp, 'opId' | 'amount' | 'txHash'>,
): InboundOp {
  return {
    type: 'payment',
    from: PAYER,
    to: platform,
    assetType: 'credit_alphanum4',
    assetCode: 'USDC',
    assetIssuer: ISSUER,
    ledger: 100,
    pagingToken: partial.pagingToken ?? `${partial.opId}-pt`,
    memoType: 'text',
    memoBytes: memoBytesForCode(code),
    ...partial,
  };
}

describe('Horizon memo-rail payments (e2e)', () => {
  let t: TestApp;
  let token: string;
  let platform: string;
  let payments: PaymentsService;

  beforeAll(async () => {
    t = await createTestApp();
    payments = t.app.get(PaymentsService);
    platform = t.app.get(AppConfig).platformAccount;
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDb(t.prisma);
    ({ token } = await registerMerchant(t));
  });

  async function createLink(amountTRY = '340.00'): Promise<{ id: string; code: string; quotedUSDC: string }> {
    const res = await t
      .http()
      .post('/api/links')
      .set({ Authorization: `Bearer ${token}` })
      .send({ title: 'Lemon order', amountTRY });
    expect(res.status).toBe(201);
    return res.body;
  }

  it('exact pay → paid; cursor persisted; health reports listenerCursor', async () => {
    const link = await createLink();
    const result = await payments.processInbound(
      op(platform, link.code, { opId: 'op-exact', amount: link.quotedUSDC, txHash: '1'.repeat(64), pagingToken: 'cur-1' }),
    );
    expect(result.outcome).toBe('applied');
    if (result.outcome === 'applied') {
      expect(result.decision).toMatchObject({ kind: 'credit', status: 'paid' });
    }

    const row = await t.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.status).toBe('paid');
    expect(row.receivedUSDC.toFixed(7)).toBe(link.quotedUSDC);

    expect(await payments.getCursor()).toBe('cur-1');
    const health = await t.http().get('/api/health').expect(200);
    expect(health.body.listener).toBe('stopped'); // NODE_ENV=test
    expect(health.body.listenerCursor).toBe('cur-1');
  });

  it('underpay then top-up → paid with two Payment rows', async () => {
    const link = await createLink(); // 340 TRY / 34 = 10 USDC
    await payments.processInbound(
      op(platform, link.code, { opId: 'op-u1', amount: '4.0000000', txHash: '2'.repeat(64), pagingToken: 'c1' }),
    );
    let row = await t.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.status).toBe('underpaid');
    expect(row.shortfallUSDC?.toFixed(7)).toBe('6.0000000');

    await payments.processInbound(
      op(platform, link.code, { opId: 'op-u2', amount: '6.0000000', txHash: '3'.repeat(64), pagingToken: 'c2' }),
    );
    row = await t.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.status).toBe('paid');
    expect(await t.prisma.payment.count({ where: { linkId: link.id } })).toBe(2);
  });

  it('overpay → paid + unallocated overpaid credit', async () => {
    const link = await createLink();
    await payments.processInbound(
      op(platform, link.code, {
        opId: 'op-over',
        amount: '12.0000000',
        txHash: '4'.repeat(64),
        pagingToken: 'c-over',
      }),
    );
    const row = await t.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.status).toBe('paid');
    const merchant = await t.prisma.merchant.findFirstOrThrow();
    expect(merchant.unallocatedUSDC.toFixed(7)).toBe('2.0000000');
    const credit = await t.prisma.unallocatedCredit.findFirstOrThrow();
    expect(credit.source).toBe('overpaid');
  });

  it('wrong asset and spoofed USDC create PaymentAttempt, no Payment', async () => {
    const link = await createLink();
    await payments.processInbound(
      op(platform, link.code, {
        opId: 'op-xlm',
        amount: '10.0000000',
        txHash: '5'.repeat(64),
        assetType: 'native',
        assetCode: null,
        assetIssuer: null,
      }),
    );
    await payments.processInbound(
      op(platform, link.code, {
        opId: 'op-spoof',
        amount: '10.0000000',
        txHash: '6'.repeat(64),
        assetIssuer: SPOOF,
      }),
    );
    expect(await t.prisma.payment.count()).toBe(0);
    const attempts = await t.prisma.paymentAttempt.findMany({ orderBy: { createdAt: 'asc' } });
    expect(attempts.map((a) => a.reason)).toEqual(['wrong_asset', 'wrong_asset']);
    expect(attempts[1].assetIssuer).toBe(SPOOF);
  });

  it('replaying the same operation is a no-op (idempotent)', async () => {
    const link = await createLink();
    const inbound = op(platform, link.code, {
      opId: 'op-idem',
      amount: link.quotedUSDC,
      txHash: '7'.repeat(64),
      pagingToken: 'c-idem',
    });
    expect((await payments.processInbound(inbound)).outcome).toBe('applied');
    expect((await payments.processInbound(inbound)).outcome).toBe('duplicate');
    expect(await t.prisma.payment.count()).toBe(1);
    expect(await t.prisma.processedOperation.count()).toBe(1);
  });

  it('open past expiresAt → link_not_open stray; underpaid past expiresAt still credits', async () => {
    const link = await createLink();
    await t.prisma.paymentLink.update({
      where: { id: link.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await payments.processInbound(
      op(platform, link.code, { opId: 'op-late', amount: link.quotedUSDC, txHash: '8'.repeat(64) }),
    );
    expect((await t.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } })).status).toBe('open');
    expect(await t.prisma.paymentAttempt.findFirst({ where: { reason: 'link_not_open' } })).toBeTruthy();
    expect((await t.prisma.merchant.findFirstOrThrow()).unallocatedUSDC.toFixed(7)).toBe(link.quotedUSDC);

    // Fresh underpaid link past expiry still accepts top-up.
    const link2 = await createLink('170.00'); // 5 USDC
    await t.prisma.paymentLink.update({
      where: { id: link2.id },
      data: {
        status: 'underpaid',
        receivedUSDC: '2.0000000',
        shortfallUSDC: '3.0000000',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await payments.processInbound(
      op(platform, link2.code, { opId: 'op-top', amount: '3.0000000', txHash: '9'.repeat(64) }),
    );
    expect((await t.prisma.paymentLink.findUniqueOrThrow({ where: { id: link2.id } })).status).toBe('paid');
  });

  it('cursor survives "restart" — second processInbound after getCursor resume point', async () => {
    const link = await createLink();
    await payments.processInbound(
      op(platform, link.code, {
        opId: 'op-a',
        amount: '4.0000000',
        txHash: 'a'.repeat(64),
        pagingToken: 'token-a',
      }),
    );
    const cursor = await payments.getCursor();
    expect(cursor).toBe('token-a');

    // Simulate restart: read cursor, apply next op (would be what stream resumes with).
    expect(await payments.getCursor()).toBe(cursor);
    await payments.processInbound(
      op(platform, link.code, {
        opId: 'op-b',
        amount: '6.0000000',
        txHash: 'b'.repeat(64),
        pagingToken: 'token-b',
      }),
    );
    expect(await payments.getCursor()).toBe('token-b');
    expect((await t.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } })).status).toBe('paid');
  });
});
