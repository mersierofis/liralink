import { createTestApp, registerMerchant, resetDb, type TestApp } from './helpers';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const IBAN = 'TR330006100519786457841326';

describe('Auth and /me (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => resetDb(t.prisma));
  afterAll(() => t.close());

  describe('POST /api/auth/register', () => {
    it('201 with a token and exactly the contract Merchant', async () => {
      const res = await t
        .http()
        .post('/api/auth/register')
        .send({ email: 'Owner@Example.test', password: 'correct horse battery', businessName: 'Erdemli Narenciye' })
        .expect(201);

      expect(typeof res.body.token).toBe('string');
      expect(Object.keys(res.body).sort()).toEqual(['merchant', 'token']);
      const m = res.body.merchant;
      // No iban key until one is set: optional fields are omitted, never null.
      expect(Object.keys(m).sort()).toEqual(
        ['autoSavePercent', 'businessName', 'createdAt', 'email', 'id', 'settlementMode', 'unallocatedUSDC'].sort(),
      );
      expect(m).toMatchObject({
        email: 'owner@example.test',
        businessName: 'Erdemli Narenciye',
        autoSavePercent: 0,
        unallocatedUSDC: '0.0000000',
        settlementMode: 'balance',
      });
      expect(m.createdAt).toMatch(ISO);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('JWT payload: sub = merchant id, 7-day lifetime', async () => {
      const { token, merchant } = await registerMerchant(t);
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.sub).toBe(merchant.id);
      expect(payload.exp - payload.iat).toBe(7 * 24 * 3600);
    });

    it('409 for an email already registered (case-insensitive)', async () => {
      await registerMerchant(t, { email: 'dup@example.test' });
      const res = await t
        .http()
        .post('/api/auth/register')
        .send({ email: 'DUP@example.test', password: 'correct horse battery', businessName: 'X' })
        .expect(409);
      expect(res.body).toEqual({ statusCode: 409, message: 'Email is already registered', error: 'Conflict' });
    });

    it('400 ApiError with string[] messages for invalid input', async () => {
      const res = await t
        .http()
        .post('/api/auth/register')
        .send({ email: 'not-an-email', password: 'short', businessName: '' })
        .expect(400);
      expect(res.body.statusCode).toBe(400);
      expect(res.body.error).toBe('Bad Request');
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.message.length).toBeGreaterThanOrEqual(3);
    });

    it('400 for a password over 72 bytes (bcrypt would silently truncate it)', async () => {
      await t
        .http()
        .post('/api/auth/register')
        .send({ email: 'long@example.test', password: 'ş'.repeat(40), businessName: 'X' }) // 40 chars, 80 bytes
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('200 with a token that works on GET /me', async () => {
      const { password } = await registerMerchant(t, { email: 'login@example.test' });
      const res = await t.http().post('/api/auth/login').send({ email: 'LOGIN@example.test', password }).expect(200);
      expect(res.body.merchant.email).toBe('login@example.test');
      await t.http().get('/api/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
    });

    it('401 for a wrong password and for an unknown email, with the same message', async () => {
      await registerMerchant(t, { email: 'login@example.test' });
      const wrong = await t.http().post('/api/auth/login').send({ email: 'login@example.test', password: 'nope-nope-nope' });
      const unknown = await t.http().post('/api/auth/login').send({ email: 'ghost@example.test', password: 'nope-nope-nope' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body).toEqual(unknown.body);
      expect(wrong.body).toEqual({ statusCode: 401, message: 'Invalid email or password', error: 'Unauthorized' });
    });
  });

  describe('JWT guard', () => {
    it.each([
      ['no header', undefined],
      ['garbage', 'Bearer not.a.jwt'],
      ['wrong secret', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl'],
    ])('401 ApiError with %s', async (_, header) => {
      const req = t.http().get('/api/me');
      const res = await (header ? req.set('Authorization', header) : req).expect(401);
      expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    });

    it('401 once the merchant no longer exists', async () => {
      const { token } = await registerMerchant(t);
      await resetDb(t.prisma);
      await t.http().get('/api/me').set('Authorization', `Bearer ${token}`).expect(401);
    });
  });

  describe('GET/PATCH /api/me', () => {
    it('returns the own profile with the full IBAN', async () => {
      const { token } = await registerMerchant(t);
      const patched = await t
        .http()
        .patch('/api/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ businessName: 'Mersin Citrus', iban: IBAN, autoSavePercent: 25 })
        .expect(200);
      expect(patched.body).toMatchObject({ businessName: 'Mersin Citrus', iban: IBAN, autoSavePercent: 25 });

      const me = await t.http().get('/api/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(me.body.iban).toBe(IBAN); // full, not masked: it is the merchant's own profile
    });

    it.each([
      [{ iban: 'TR33 0006 1005 1978 6457 8413 26' }],
      [{ iban: 'DE89370400440532013000' }],
      [{ autoSavePercent: 51 }],
      [{ autoSavePercent: -1 }],
      [{ autoSavePercent: '10' }],
      [{ businessName: '' }],
    ])('400 for %j', async (body) => {
      const { token } = await registerMerchant(t);
      await t.http().patch('/api/me').set('Authorization', `Bearer ${token}`).send(body).expect(400);
    });

    it('changes the password only with both fields: 400 if one, 403 if currentPassword is wrong', async () => {
      const { token, password, merchant } = await registerMerchant(t);
      const auth = { Authorization: `Bearer ${token}` };

      await t.http().patch('/api/me').set(auth).send({ newPassword: 'another long one' }).expect(400);
      await t.http().patch('/api/me').set(auth).send({ currentPassword: password }).expect(400);
      const forbidden = await t
        .http()
        .patch('/api/me')
        .set(auth)
        .send({ currentPassword: 'wrong-wrong', newPassword: 'another long one' })
        .expect(403);
      expect(forbidden.body).toEqual({ statusCode: 403, message: 'currentPassword is wrong', error: 'Forbidden' });

      await t.http().patch('/api/me').set(auth).send({ currentPassword: password, newPassword: 'another long one' }).expect(200);
      await t.http().post('/api/auth/login').send({ email: merchant.email, password }).expect(401);
      await t.http().post('/api/auth/login').send({ email: merchant.email, password: 'another long one' }).expect(200);
    });
  });
});
