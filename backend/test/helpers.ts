import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import type { FxQuote } from '../src/fx/fx.service';
import { FxService } from '../src/fx/fx.service';
import { FxUnavailableError } from '../src/fx/fx.types';
import { PrismaService } from '../src/prisma/prisma.service';

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
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const fx = new MovableFx();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FxService)
    .useValue(fx)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  setupApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, http: () => request(app.getHttpServer()), prisma, fx, close: () => app.close() };
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
