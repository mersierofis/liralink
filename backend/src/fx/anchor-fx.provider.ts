import { Logger } from '@nestjs/common';
import { StellarToml } from '@stellar/stellar-sdk';
import { ANCHOR_RATE_DP, USDC_DP, invertPriceDown, isPositiveDecimal, ratio, sameDecimal } from '../common/money';
import { FxUnavailableError, type FxProvider, type FxQuote } from './fx.types';

/** Only the stellar.toml fields this provider reads. */
export interface AnchorToml {
  NETWORK_PASSPHRASE?: string;
  ANCHOR_QUOTE_SERVER?: string;
}

export interface AnchorFxOptions {
  /** Anchor home domain without scheme, e.g. tr-mock-anchor.fly.dev. */
  homeDomain: string;
  usdcIssuer: string;
  /** Refuse an anchor that serves another network. */
  networkPassphrase: string;
  // Seams for tests; production uses the SDK resolver, global fetch and the clock.
  resolveToml?: (domain: string) => Promise<AnchorToml>;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

const TOML_TTL_MS = 3_600_000; // re-read hourly (anchor.md)
const TOML_TIMEOUT_MS = 20_000;
const PRICE_TIMEOUT_MS = 10_000;
const PRICE_MAX_BYTES = 64 * 1024;
/** We price 1 USDC; the answer is per-unit, so a larger amount would only add rounding. */
const SELL_AMOUNT = '1';

/**
 * USDC/TRY from the anchor's SEP-38 `GET /price`, fetched fresh for every call (no rate cache).
 * rate = 1 / total_price rounded DOWN to 6 dp (total_price includes the spread, price does not).
 * Any failure throws FxUnavailableError: there is no fallback rate.
 */
export class AnchorFxProvider implements FxProvider {
  private readonly logger = new Logger(AnchorFxProvider.name);
  private readonly resolveToml: (domain: string) => Promise<AnchorToml>;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly sellAsset: string;
  private quoteServer: { url: string; at: number } | null = null;

  constructor(private readonly opts: AnchorFxOptions) {
    this.resolveToml =
      opts.resolveToml ??
      ((domain) => StellarToml.Resolver.resolve(domain, { timeout: TOML_TIMEOUT_MS, allowedRedirects: 0 }));
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.sellAsset = `stellar:USDC:${opts.usdcIssuer}`;
  }

  async getRate(): Promise<FxQuote> {
    try {
      return await this.fetchRate();
    } catch (err) {
      const e = err instanceof FxUnavailableError ? err : new FxUnavailableError(`anchor rate failed: ${describe(err)}`);
      this.logger.error(`${this.opts.homeDomain}: ${e.message}`);
      throw e;
    }
  }

  private async fetchRate(): Promise<FxQuote> {
    const url = new URL(`${await this.quoteServerUrl()}/price`);
    url.search = new URLSearchParams({
      sell_asset: this.sellAsset,
      buy_asset: 'iso4217:TRY',
      sell_amount: SELL_AMOUNT,
      context: 'sep6',
    }).toString();

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FxUnavailableError(`anchor /price unreachable: ${describe(err)}`);
    }
    const fetchedAt = this.now();
    // Prices are public on this anchor. An anchor that wants a SEP-10 JWT answers 401/403, which
    // this provider does not handle yet (no SEP-10 session exists): it fails like any non-2xx.
    if (!res.ok) throw new FxUnavailableError(`anchor /price answered HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > PRICE_MAX_BYTES) throw new FxUnavailableError('anchor /price body too large');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new FxUnavailableError('anchor /price body is not JSON');
    }
    return this.toQuote(body, fetchedAt);
  }

  /** Validates every field it uses; anything unexpected is an error, never a default. */
  toQuote(body: unknown, fetchedAt: Date): FxQuote {
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const { total_price: totalPrice, price, sell_amount: sellAmount } = b;
    if (!isPositiveDecimal(totalPrice)) throw new FxUnavailableError('anchor /price: total_price missing or not a decimal > 0');
    if (!isPositiveDecimal(price)) throw new FxUnavailableError('anchor /price: price missing or not a decimal > 0');
    if (!isPositiveDecimal(sellAmount) || !sameDecimal(sellAmount, SELL_AMOUNT)) {
      throw new FxUnavailableError(`anchor /price: sell_amount is ${JSON.stringify(sellAmount)}, asked for ${SELL_AMOUNT}`);
    }

    const rate = invertPriceDown(totalPrice, ANCHOR_RATE_DP);
    const midRate = invertPriceDown(price, ANCHOR_RATE_DP);
    if (!isPositiveDecimal(rate)) throw new FxUnavailableError(`anchor /price: total_price ${totalPrice} gives a zero rate`);

    return { rate, midRate, spread: this.spread(b.fee, sellAmount), source: 'anchor', fetchedAt, raw: body };
  }

  /** The anchor states its spread as a fee in the sell asset (USDC) per `sell_amount`. */
  private spread(fee: unknown, sellAmount: string): string | null {
    const f = (typeof fee === 'object' && fee !== null ? fee : {}) as Record<string, unknown>;
    if (f.asset === this.sellAsset && typeof f.total === 'string' && /^\d+(\.\d+)?$/.test(f.total)) {
      return ratio(f.total, sellAmount, USDC_DP);
    }
    this.logger.warn(`${this.opts.homeDomain}: /price fee is not stated in USDC; spread not recorded`);
    return null;
  }

  private async quoteServerUrl(): Promise<string> {
    const nowMs = this.now().getTime();
    if (this.quoteServer && nowMs - this.quoteServer.at < TOML_TTL_MS) return this.quoteServer.url;

    let toml: AnchorToml;
    try {
      toml = await this.resolveToml(this.opts.homeDomain);
    } catch (err) {
      throw new FxUnavailableError(`stellar.toml unreadable: ${describe(err)}`);
    }
    if (toml.NETWORK_PASSPHRASE !== this.opts.networkPassphrase) {
      throw new FxUnavailableError(`stellar.toml NETWORK_PASSPHRASE is ${JSON.stringify(toml.NETWORK_PASSPHRASE)}, not ours`);
    }
    const q = toml.ANCHOR_QUOTE_SERVER;
    if (typeof q !== 'string' || !q.startsWith('https://')) {
      throw new FxUnavailableError('stellar.toml has no https ANCHOR_QUOTE_SERVER');
    }
    this.quoteServer = { url: q.replace(/\/+$/, ''), at: nowMs };
    return this.quoteServer.url;
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? `${err.message} (${cause.message})` : err.message;
  }
  return String(err);
}
