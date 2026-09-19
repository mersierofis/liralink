import { Keypair } from '@stellar/stellar-sdk';
import { createTestApp, type TestApp } from './helpers';

describe('System (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('GET /api/health → the contract GetHealthResponse', async () => {
    const res = await t.http().get('/api/health').expect(200);
    expect(res.body).toEqual({
      ok: true, // database reachable
      horizon: 'down', // HORIZON_URL points at a closed port in tests
      anchor: 'mock',
      listener: 'stopped', // SSE disabled when NODE_ENV=test
      listenerCursor: null,
      platformAccount: Keypair.fromSecret(process.env.PLATFORM_ACCOUNT_SECRET!).publicKey(),
      settlementMode: 'balance',
    });
  });

  it('serves Swagger at /docs, outside the /api prefix', async () => {
    const res = await t.http().get('/docs-json').expect(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/auth/register', '/api/auth/login', '/api/me', '/api/links', '/api/links/{id}',
        '/api/links/{id}/cancel', '/api/pay/{code}', '/api/health',
      ]),
    );
    await t.http().get('/docs').expect(200);
  });

  it('unknown routes answer with an ApiError', async () => {
    const res = await t.http().get('/api/nope').expect(404);
    expect(res.body).toEqual({ statusCode: 404, message: 'Cannot GET /api/nope', error: 'Not Found' });
  });
});
