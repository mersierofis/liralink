import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import type { FxQuote } from '../src/fx/fx.service';
import { FxService } from '../src/fx/fx.service';
import { FxUnavailableError } from '../src/fx/fx.types';
import { ListenerService } from '../src/listener/listener.service';
import { PAYMENT_SOURCE, type PaymentSource } from '../src/listener/payment-source';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppConfig } from '../src/config/app-config';
import { type Env, validateEnv } from '../src/config/env';
import { ANCHOR_ADAPTERS, type AnchorAdapter } from '../src/settlements/anchor/anchor-adapter';
import { SettlementsService } from '../src/settlements/settlements.service';

/**
 * Horizon stand-in: a list of records in paging-token order. `page` and `latestPagingToken` read
 * it like Horizon's REST API; `push` delivers a record over the open "stream".
 */
export class FakePaymentSource implements PaymentSource {
  records: Record<string, unknown>[] = [];
  pageCalls: string[] = [];
  streamCursors: string[] = [];
  private onRecord: ((r: unknown) => void) | null = null;

  async latestPagingToken(): Promise<string | null> {
    return (this.records.at(-1)?.paging_token as string | undefined) ?? null;
  }
  async page(cursor: string, limit: number): Promise<unknown[]> {
    this.pageCalls.push(cursor);
    return this.records.filter((r) => BigInt(r.paging_token as string) > BigInt(cursor)).slice(0, limit);
  }
  stream(cursor: string, onRecord: (r: unknown) => void): () => void {
    this.streamCursors.push(cursor);
    this.onRecord = onRecord;
    return () => (this.onRecord = null);
  }
  /** Adds a record to "Horizon" and delivers it over the stream, if one is open. */
  push(record: Record<string, unknown>): void {
    this.records.push(record);
    this.onRecord?.(record);
  }
  /** Delivers a record over the stream again without adding it (an SSE replay). */
  replay(record: Record<string, unknown>): void {
    this.onRecord?.(record);
  }
}

/** An FX source the test can move, or break, to prove what link creation does with it. */
export class MovableFx {
  rate = '34.00';
  midRate = '34.17';
  spread: string | null = '0.0050000';
  fetchedAt = new Date('2026-09-19T10:00:00.000Z');
  /** When set, getRate() fails the way the anchor provider does. */
  failure: string | null = null;

  async getRate(): Promise<FxQuote> {
    if (this.failure) throw new FxUnavailableError(this.failure);
    return {
      rate: this.rate,
      midRate: this.midRate,
      spread: this.spread,
      source: 'anchor',
      fetchedAt: this.fetchedAt,
      raw: { total_price: 'recorded', note: 'test double' },
    };
  }
}

export interface TestApp {
  app: INestApplication<App>;
  http: () => ReturnType<typeof request>;
  prisma: PrismaService;
  fx: MovableFx;
  source: FakePaymentSource;
  listener: ListenerService;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  /** Config values on top of the test environment (e.g. ANCHOR_PROVIDER). */
  env?: Partial<Env>;
  /** Anchor adapters instead of the ones built from config. */
  adapters?: (config: AppConfig) => AnchorAdapter[];
}

export async function createTestApp(source = new FakePaymentSource(), opts: TestAppOptions = {}): Promise<TestApp> {
  const fx = new MovableFx();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FxService)
    .useValue(fx)
    .overrideProvider(PAYMENT_SOURCE)
    .useValue(source);
  const config = opts.env ? new AppConfig({ ...validateEnv(process.env), ...opts.env } as Env) : null;
  if (config) builder = builder.overrideProvider(AppConfig).useValue(config);
  if (opts.adapters) {
    const make = opts.adapters;
    builder = builder.overrideProvider(ANCHOR_ADAPTERS).useFactory({ factory: (c: AppConfig) => make(c), inject: [AppConfig] });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  setupApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const listener = app.get(ListenerService);
  await listener.idle(); // the listener connects on bootstrap
  // The settlement job also runs at bootstrap, possibly on the previous test's rows: let it finish
  // before the test truncates anything, or the TRUNCATE deadlocks with it.
  await app.get(SettlementsService).runJob();
  return { app, http: () => request(app.getHttpServer()), prisma, fx, source, listener, close: () => app.close() };
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Settlement", "Payment", "PaymentAttempt", "UnallocatedCredit", "Withdrawal", "PaymentLink", "Merchant", "ProcessedOperation", "ListenerCursor" CASCADE',
  );
}

let counter = 0;
export async function registerMerchant(
  t: TestApp,
  overrides: Partial<{ email: string; password: string; businessName: string }> = {},
): Promise<{ token: string; merchant: Record<string, unknown>; password: string }> {
  counter++;
  const body = {
    email: `merchant${counter}@example.test`,
    password: 'correct horse battery',
    businessName: 'Erdemli Narenciye A.Ş.',
    ...overrides,
  };
  const res = await t.http().post('/api/auth/register').send(body).expect(201);
  return { token: res.body.token, merchant: res.body.merchant, password: body.password };
}

export const CIRCLE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const IMPOSTOR = 'GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6';
export const PAYER = 'GDKC65WHV2UPVEUDG4ZPCJEHIW3C7KXOSZ4TV2O3GIHVDWUHVKOF26RL';
export const QUOTED = '147.0588236'; // 5000.00 TRY at 34.00, rounded up

let seq = 0;
/**
 * A Horizon payments record exactly as the SDK hands it over with .join('transactions'): the
 * transaction in `transaction_attr`, its linked `ledger` a function and the number in `ledger_attr`.
 */
export function record(
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

