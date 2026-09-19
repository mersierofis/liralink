import { Keypair } from '@stellar/stellar-sdk';
import { validateEnv } from './env';

const base = {
  NODE_ENV: 'test',
  PORT: '3000',
  CORS_ORIGINS: 'http://localhost:5173',
  PAY_WEB_BASE_URL: 'http://localhost:5174/p',
  DATABASE_URL: 'postgresql://u@localhost:5432/liralink_test',
  JWT_SECRET: 'x'.repeat(32),
  STELLAR_NETWORK: 'testnet',
  HORIZON_URL: 'https://horizon-testnet.stellar.org',
  USDC_CODE: 'USDC',
  USDC_ISSUER: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  PLATFORM_ACCOUNT_SECRET: Keypair.random().secret(),
  ANCHOR_PROVIDER: 'mock',
  LINK_DEFAULT_EXPIRY_HOURS: '24',
};

describe('FX configuration', () => {
  it('defaults to the anchor provider, which needs ANCHOR_HOME_DOMAIN', () => {
    expect(() => validateEnv(base)).toThrow(/ANCHOR_HOME_DOMAIN: required when FX_PROVIDER is anchor/);
    const env = validateEnv({ ...base, ANCHOR_HOME_DOMAIN: 'tr-mock-anchor.fly.dev' });
    expect(env.FX_PROVIDER).toBe('anchor');
  });

  it('treats an empty FX_PROVIDER (as in .env.example) as the default', () => {
    expect(validateEnv({ ...base, FX_PROVIDER: '', ANCHOR_HOME_DOMAIN: 'tr-mock-anchor.fly.dev' }).FX_PROVIDER).toBe('anchor');
  });

  it('rejects a home domain with a scheme or path', () => {
    expect(() => validateEnv({ ...base, ANCHOR_HOME_DOMAIN: 'https://tr-mock-anchor.fly.dev' })).toThrow(/ANCHOR_HOME_DOMAIN/);
  });

  it('keeps mock available, with its rate required', () => {
    expect(() => validateEnv({ ...base, FX_PROVIDER: 'mock' })).toThrow(/FX_MOCK_RATE_TRY_PER_USDC: required/);
    expect(validateEnv({ ...base, FX_PROVIDER: 'mock', FX_MOCK_RATE_TRY_PER_USDC: '34.00' }).FX_PROVIDER).toBe('mock');
  });

  it("refuses 'live', which is not implemented", () => {
    expect(() => validateEnv({ ...base, FX_PROVIDER: 'live', ANCHOR_HOME_DOMAIN: 'x.test' })).toThrow(/'live' is not implemented/);
  });
});
