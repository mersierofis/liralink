import { Keypair } from '@stellar/stellar-sdk';

// E2E runs against a real Postgres and TRUNCATEs it. DATABASE_URL comes from the caller's
// environment and must name a database ending in "_test", so a dev or prod database is never wiped.
const url = process.env.DATABASE_URL ?? '';
const dbName = url.replace(/[?#].*$/, '').split('/').pop() ?? '';
if (!dbName.endsWith('_test')) {
  throw new Error(`E2E needs DATABASE_URL pointing at a *_test database (got "${dbName || 'nothing'}")`);
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3999', // never bound: supertest drives the app in-process
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
  PAY_WEB_BASE_URL: 'http://localhost:5174/p',
  JWT_SECRET: 'e2e-only-secret-e2e-only-secret-e2e-only',
  STELLAR_NETWORK: 'testnet',
  HORIZON_URL: 'http://127.0.0.1:9', // nothing listens there: /health reports horizon 'down' at once
  USDC_CODE: 'USDC',
  USDC_ISSUER: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  PLATFORM_ACCOUNT_SECRET: Keypair.random().secret(), // never funded, never leaves the test process
  FX_PROVIDER: 'mock',
  FX_MOCK_RATE_TRY_PER_USDC: '34.00',
  ANCHOR_PROVIDER: 'mock',
  ANCHOR_MOCK_DELAY_MS: '20',
  LINK_DEFAULT_EXPIRY_HOURS: '24',
});
