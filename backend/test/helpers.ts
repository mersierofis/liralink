import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import type { FxQuote } from '../src/fx/fx.service';
import { FxService } from '../src/fx/fx.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** An FX source the test can move, to prove that existing quotes do not follow it. */
export class MovableFx {
  rate = '34.00';
  async getRate(): Promise<FxQuote> {
    return { rate: this.rate, source: 'mock' };
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
    'TRUNCATE "Settlement", "Payment", "PaymentAttempt", "UnallocatedCredit", "Withdrawal", "PaymentLink", "Merchant" CASCADE',
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
