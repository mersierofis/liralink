import { Keypair, StellarToml, TransactionBuilder, WebAuth } from '@stellar/stellar-sdk';
import type { AnchorHttp } from './anchor-http';

export interface AnchorEndpoints {
  transferServer: string;
  webAuthEndpoint: string;
  signingKey: string;
  kycServer: string | null;
}

export interface AnchorToml {
  NETWORK_PASSPHRASE?: string;
  TRANSFER_SERVER?: string;
  WEB_AUTH_ENDPOINT?: string;
  SIGNING_KEY?: string;
  KYC_SERVER?: string;
}

const TOML_TTL_MS = 3_600_000; // re-read hourly (anchor.md, step 1)
const JWT_MARGIN_S = 60; // use a cached JWT until a minute before it expires

const httpsOrThrow = (name: string, v: unknown): string => {
  if (typeof v !== 'string' || !v.startsWith('https://')) throw new Error(`stellar.toml ${name} missing or not https`);
  return v.replace(/\/+$/, '');
};

/**
 * SEP-1 discovery and SEP-10 login, one anchor identity per merchant memo (anchor.md, steps 1 and 3).
 * The platform account signs every challenge; each memo is its own anchor customer.
 */
export class AnchorSession {
  private endpointsCache: { at: number; value: AnchorEndpoints } | null = null;
  private readonly jwts = new Map<string, { token: string; exp: number }>();

  constructor(
    private readonly opts: {
      homeDomain: string;
      networkPassphrase: string;
      keypair: Keypair;
      http: AnchorHttp;
      resolveToml?: (domain: string) => Promise<AnchorToml>;
      now?: () => number;
    },
  ) {}

  get account(): string {
    return this.opts.keypair.publicKey();
  }

  get homeDomain(): string {
    return this.opts.homeDomain;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  async endpoints(): Promise<AnchorEndpoints> {
    if (this.endpointsCache && this.now() - this.endpointsCache.at < TOML_TTL_MS) return this.endpointsCache.value;
    const resolve = this.opts.resolveToml ?? ((d: string) => StellarToml.Resolver.resolve(d, { timeout: 20_000, allowedRedirects: 0 }));
    const toml = await resolve(this.opts.homeDomain);
    if (toml.NETWORK_PASSPHRASE !== this.opts.networkPassphrase) {
      throw new Error(`anchor ${this.opts.homeDomain} serves another network: ${JSON.stringify(toml.NETWORK_PASSPHRASE)}`);
    }
    if (typeof toml.SIGNING_KEY !== 'string') throw new Error('stellar.toml has no SIGNING_KEY');
    const value: AnchorEndpoints = {
      transferServer: httpsOrThrow('TRANSFER_SERVER', toml.TRANSFER_SERVER),
      webAuthEndpoint: httpsOrThrow('WEB_AUTH_ENDPOINT', toml.WEB_AUTH_ENDPOINT),
      signingKey: toml.SIGNING_KEY,
      kycServer: toml.KYC_SERVER === undefined ? null : httpsOrThrow('KYC_SERVER', toml.KYC_SERVER),
    };
    // A rotated signing key invalidates every JWT we hold.
    if (this.endpointsCache && this.endpointsCache.value.signingKey !== value.signingKey) this.jwts.clear();
    this.endpointsCache = { at: this.now(), value };
    return value;
  }

  /** A JWT for the anchor customer `memo`. Cached per memo until a minute before `exp`. */
  async jwt(memo: string): Promise<string> {
    const cached = this.jwts.get(memo);
    if (cached && cached.exp - JWT_MARGIN_S > this.now() / 1000) return cached.token;

    const ep = await this.endpoints();
    const challenge = await this.opts.http.call<{ transaction?: string; network_passphrase?: string }>('SEP-10 challenge', {
      method: 'GET',
      url: ep.webAuthEndpoint,
      query: { account: this.account, memo, home_domain: this.opts.homeDomain },
    });
    if (typeof challenge.transaction !== 'string') throw new Error('SEP-10 challenge without transaction');
    if (challenge.network_passphrase !== undefined && challenge.network_passphrase !== this.opts.networkPassphrase) {
      throw new Error('SEP-10 challenge for another network');
    }
    // Verify BEFORE signing: server signature, sequence 0, time bounds, "<home domain> auth",
    // web_auth_domain (the WEB_AUTH_ENDPOINT host), our account, and the memo we asked for.
    const read = WebAuth.readChallengeTx(
      challenge.transaction,
      ep.signingKey,
      this.opts.networkPassphrase,
      this.opts.homeDomain,
      new URL(ep.webAuthEndpoint).host,
    );
    if (read.clientAccountID !== this.account) throw new Error('SEP-10 challenge for another account');
    if (read.memo !== memo) throw new Error(`SEP-10 challenge dropped the memo (asked ${memo}, got ${String(read.memo)})`);

    const tx = TransactionBuilder.fromXDR(challenge.transaction, this.opts.networkPassphrase);
    tx.sign(this.opts.keypair); // signed locally, posted back, never submitted to the network
    const { token } = await this.opts.http.call<{ token?: string }>('SEP-10 token', {
      method: 'POST',
      url: ep.webAuthEndpoint,
      json: { transaction: tx.toXDR() },
    });
    if (typeof token !== 'string') throw new Error('SEP-10 answered without a token');

    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { sub?: unknown; exp?: unknown };
    // An anchor that ignored the memo would merge every merchant into one customer: refuse it.
    if (payload.sub !== `${this.account}:${memo}`) throw new Error(`SEP-10 JWT sub is ${String(payload.sub)}, expected ${this.account}:${memo}`);
    if (typeof payload.exp !== 'number') throw new Error('SEP-10 JWT without exp');
    this.jwts.set(memo, { token, exp: payload.exp });
    return token;
  }

  /** After a 401/403: the next call logs in again. */
  evict(memo: string): void {
    this.jwts.delete(memo);
  }
}
