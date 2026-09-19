import { StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { isValidRate } from '../common/money';

// Every variable in ../.env.example, validated at boot (fail fast). An empty value counts as unset,
// because .env.example ships every key with an empty value.
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const str = () => z.preprocess(blank, z.string());
const optStr = () => z.preprocess(blank, z.string().optional());
const url = () => z.preprocess(blank, z.url());
const optUrl = () => z.preprocess(blank, z.url().optional());
const int = (min: number) => z.preprocess(blank, z.coerce.number().int().min(min));
const optInt = (min: number) => z.preprocess(blank, z.coerce.number().int().min(min).optional());
const flag = () => z.preprocess(blank, z.enum(['1']).optional());

export const envSchema = z
  .object({
    // Runtime
    NODE_ENV: z.preprocess(blank, z.enum(['development', 'test', 'production'])),
    PORT: int(1),
    CORS_ORIGINS: str().transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
    PAY_WEB_BASE_URL: url().transform((s) => s.replace(/\/+$/, '')),

    // Database
    DATABASE_URL: str().refine((s) => /^postgres(ql)?:\/\//.test(s), 'must be a postgresql:// URL'),

    // Auth
    JWT_SECRET: str().refine((s) => s.length >= 32, 'must be at least 32 characters'),

    // Stellar network. PayQuote.network is the literal 'testnet' in the API contract, and the TRY
    // anchor and x402 are testnet-only, so this build refuses anything else.
    STELLAR_NETWORK: z.preprocess(blank, z.literal('testnet')),
    HORIZON_URL: url(),
    SOROBAN_RPC_URL: optUrl(),
    NETWORK_PASSPHRASE: optStr(),

    // Assets. PayQuote.asset.code is the literal 'USDC' in the API contract.
    USDC_CODE: z.preprocess(blank, z.literal('USDC')),
    USDC_ISSUER: str().refine((s) => StrKey.isValidEd25519PublicKey(s), 'must be a G… account id'),

    // Platform account
    PLATFORM_ACCOUNT_SECRET: str().refine((s) => StrKey.isValidEd25519SecretSeed(s), 'must be an S… secret seed'),

    // Soroban invoice contract (empty disables the contract rail)
    INVOICE_CONTRACT_ID: optStr(),

    // FX. Default: the anchor's SEP-38 price. There is no fallback between providers.
    FX_PROVIDER: z.preprocess(blank, z.enum(['mock', 'live', 'anchor']).default('anchor')),
    FX_MOCK_RATE_TRY_PER_USDC: z.preprocess(
      blank,
      z.string().refine(isValidRate, 'must be a decimal string > 0 with at most 7 dp').optional(),
    ),
    FX_LIVE_URL: optUrl(),

    // Anchor
    ANCHOR_PROVIDER: z.preprocess(blank, z.enum(['mock', 'sep6', 'sep24'])),
    ANCHOR_HOME_DOMAIN: z.preprocess(
      blank,
      z
        .string()
        .regex(/^[a-z0-9.-]+(:\d+)?$/i, 'must be a bare host name without scheme or path, e.g. tr-mock-anchor.fly.dev')
        .optional(),
    ),
    ANCHOR_SEP24_TEST_KYC_URL: optUrl(),
    ANCHOR_SEP24_ENCODING: z.preprocess(blank, z.enum(['multipart', 'urlencoded']).optional()),
    ANCHOR_MOCK_DELAY_MS: optInt(0),

    // Payment links
    LINK_DEFAULT_EXPIRY_HOURS: int(1),
    QUOTE_TTL_MINUTES: optInt(1),

    // x402
    X402_FACILITATOR_URL: optUrl(),

    // Scripts only
    SEED_DEMO_PASSWORD: optStr(),
    DEMO_PAYER_ADDRESS: optStr(),
    AGENT_SECRET: optStr(),

    // Opt-in live e2e
    SEP6_E2E: flag(),
    SEP24_E2E: flag(),
    SEP24_MANUAL_KYC: flag(),
    SEP24_URL_FILE: optStr(),
    USDC_WD_E2E: flag(),
    USDC_WD_E2E_DESTINATION: optStr(),
  })
  // Refuse to boot rather than price links from a rate source that cannot work.
  .refine((e) => e.FX_PROVIDER !== 'live', {
    path: ['FX_PROVIDER'],
    message: "'live' is not implemented; use 'anchor' or 'mock'",
  })
  .refine((e) => e.FX_PROVIDER !== 'anchor' || e.ANCHOR_HOME_DOMAIN !== undefined, {
    path: ['ANCHOR_HOME_DOMAIN'],
    message: 'required when FX_PROVIDER is anchor',
  })
  .refine((e) => e.FX_PROVIDER !== 'mock' || e.FX_MOCK_RATE_TRY_PER_USDC !== undefined, {
    path: ['FX_MOCK_RATE_TRY_PER_USDC'],
    message: 'required when FX_PROVIDER is mock',
  });

export type Env = z.infer<typeof envSchema>;

/** `validate` hook for @nestjs/config: throws one error listing every bad variable. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return result.data;
}
