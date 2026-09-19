import { ServiceUnavailableException } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { AppConfig } from '../config/app-config';
import type { Env } from '../config/env';
import type { Merchant as MerchantRow } from '../generated/prisma/client';
import type { FxService } from '../fx/fx.service';
import { FxUnavailableError } from '../fx/fx.types';
import type { PrismaService } from '../prisma/prisma.service';
import type { LinkWithPayments } from './link.mapper';
import { LinksService } from './links.service';

/** Quote locking: amountTRY and quotedUSDC are fixed at creation and never follow a later rate. */
describe('LinksService quote locking', () => {
  const config = new AppConfig({
    PAY_WEB_BASE_URL: 'http://pay.test/p',
    STELLAR_NETWORK: 'testnet',
    PLATFORM_ACCOUNT_SECRET: Keypair.random().secret(),
    ANCHOR_PROVIDER: 'mock',
    LINK_DEFAULT_EXPIRY_HOURS: 24,
  } as Env);
  const merchant = { id: '00000000-0000-4000-8000-000000000001', businessName: 'Erdemli Narenciye' } as MerchantRow;

  let rate: string;
  let fxDown = false;
  const fetchedAt = new Date('2026-09-19T11:26:33.000Z');
  const fx = {
    getRate: jest.fn(async () => {
      if (fxDown) throw new FxUnavailableError('anchor /price answered HTTP 502');
      return { rate, midRate: '34.170000', spread: '0.0050237', source: 'anchor' as const, fetchedAt, raw: { total_price: 'x' } };
    }),
  } as unknown as FxService;

  // An in-memory stand-in for the one table the service touches.
  const rows = new Map<string, LinkWithPayments>();
  const prisma = {
    paymentLink: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row = {
          id: `00000000-0000-4000-8000-00000000000${rows.size + 2}`,
          status: 'open',
          receivedUSDC: { toFixed: () => '0' },
          shortfallUSDC: null,
          onchainContractId: null,
          onchainInvoiceCode: null,
          onchainDeadlineLedger: null,
          onchainTxHash: null,
          createdAt: now,
          updatedAt: now,
          payments: [],
          ...data,
          // The database hands decimals back as Prisma Decimals; mimic their toFixed().
          amountTRY: { toFixed: () => data.amountTRY as string },
          quotedUSDC: { toFixed: () => data.quotedUSDC as string },
          fxRate: { toFixed: () => data.fxRate as string },
        } as unknown as LinkWithPayments;
        rows.set(row.id, row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
    },
  } as unknown as PrismaService;

  const service = new LinksService(prisma, fx, config);

  beforeEach(() => {
    rows.clear();
    jest.clearAllMocks();
    rate = '34.00';
    fxDown = false;
  });

  it('computes quotedUSDC once, from the rate at creation, rounded up to 7 dp', async () => {
    const link = await service.create(merchant, { title: 'Lemon order #1042', amountTRY: '5000.00' });

    expect(link.amountTRY).toBe('5000.00');
    expect(link.quotedUSDC).toBe('147.0588236');
    expect(link.fxRate).toBe('34.0000000');
    expect(fx.getRate).toHaveBeenCalledTimes(1);
    // What was written is exactly what is returned: strings, not floats.
    const data = (prisma.paymentLink.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ amountTRY: '5000.00', quotedUSDC: '147.0588236', fxRate: '34.00' });
  });

  it('stores what was quoted and when: source, timestamp, mid rate, spread and the raw response', async () => {
    await service.create(merchant, { title: 'x', amountTRY: '10.00' });
    const data = (prisma.paymentLink.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({
      fxSource: 'anchor',
      fxRateAt: fetchedAt,
      fxMidRate: '34.170000',
      fxSpread: '0.0050237',
      fxQuoteRaw: { total_price: 'x' },
    });
  });

  it('never recomputes the quote after the rate moves', async () => {
    const created = await service.create(merchant, { title: 'Lemon order #1042', amountTRY: '5000.00' });
    rate = '40.00';

    const read = await service.get(merchant, created.id);

    expect(read.amountTRY).toBe('5000.00');
    expect(read.quotedUSDC).toBe('147.0588236');
    expect(read.fxRate).toBe('34.0000000');
    expect(fx.getRate).toHaveBeenCalledTimes(1); // reading a link never asks for a rate
  });

  it('locks the quote for the whole life of the link: quoteExpiresAt = expiresAt', async () => {
    const before = Date.now();
    const link = await service.create(merchant, { title: 'x', amountTRY: '10.00', expiresInHours: 2 });

    expect(link.quoteExpiresAt).toBe(link.expiresAt);
    const expires = new Date(link.expiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 2 * 3_600_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 2 * 3_600_000);
  });

  it('creates no link and answers 503 when the rate cannot be fetched', async () => {
    fxDown = true;
    const err = await service.create(merchant, { title: 'x', amountTRY: '10.00' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).message).toBe(
      'FX rate unavailable, no link created: anchor /price answered HTTP 502',
    );
    expect(prisma.paymentLink.create).not.toHaveBeenCalled();
  });

  it('gives a later link the later rate without touching the earlier one', async () => {
    const first = await service.create(merchant, { title: 'a', amountTRY: '5000.00' });
    rate = '40.00';
    const second = await service.create(merchant, { title: 'b', amountTRY: '5000.00' });

    expect(second.quotedUSDC).toBe('125.0000000');
    expect((await service.get(merchant, first.id)).quotedUSDC).toBe('147.0588236');
  });
});
