import { Logger } from '@nestjs/common';
import { Networks } from '@stellar/stellar-sdk';
import { quoteUSDC } from '../common/money';
import { AnchorFxProvider, type AnchorToml } from './anchor-fx.provider';
import { RECORDED_PRICE_BODY, RECORDED_TOML } from './fixtures/tr-mock-anchor';
import { FxUnavailableError } from './fx.types';

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function setup(opts: { toml?: AnchorToml | Error; response?: Response | Error; now?: Date } = {}) {
  let clock = opts.now ?? new Date('2026-09-19T11:26:33.000Z');
  const resolveToml = jest.fn(async () => {
    if (opts.toml instanceof Error) throw opts.toml;
    return opts.toml ?? RECORDED_TOML;
  });
  const fetchFn = jest.fn(async () => {
    // Anything that is not a Response is thrown, as fetch does (a DOMException is not an Error in Jest's realm).
    if (opts.response !== undefined && !(opts.response instanceof Response)) throw opts.response;
    return opts.response ?? new Response(RECORDED_PRICE_BODY, { status: 200 });
  }) as unknown as jest.MockedFunction<typeof fetch>;
  const provider = new AnchorFxProvider({
    homeDomain: 'tr-mock-anchor.fly.dev',
    usdcIssuer: ISSUER,
    networkPassphrase: Networks.TESTNET,
    resolveToml,
    fetchFn,
    now: () => clock,
  });
  return { provider, resolveToml, fetchFn, tick: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

const priceBody = (patch: Record<string, unknown>) =>
  new Response(JSON.stringify({ ...JSON.parse(RECORDED_PRICE_BODY), ...patch }), { status: 200 });

describe('AnchorFxProvider against the recorded tr-mock-anchor responses', () => {
  beforeAll(() => Logger.overrideLogger(false)); // the provider logs every failure at ERROR

  it('rate = 1 / total_price rounded DOWN to 6 dp; mid rate from price; spread from the USDC fee', async () => {
    const { provider } = setup();
    const q = await provider.getRate();

    expect(q).toEqual({
      rate: '48.540000', // 1 / 0.0206015657 = 48.54000004475…
      midRate: '48.785077', // 1 / 0.0204980712 = 48.78507788576…
      spread: '0.0050237', // fee.total / sell_amount, in USDC
      source: 'anchor',
      fetchedAt: new Date('2026-09-19T11:26:33.000Z'),
      raw: JSON.parse(RECORDED_PRICE_BODY),
    });
  });

  it('prices links from that rate: TRY 2 dp in, USDC 7 dp out, rounded up', async () => {
    const { rate } = await setup().provider.getRate();
    // Checked against Python's decimal, ROUND_CEILING.
    expect(quoteUSDC('50.00', rate)).toBe('1.0300783');
    expect(quoteUSDC('5000.00', rate)).toBe('103.0078286');
    expect(quoteUSDC('48.54', rate)).toBe('1.0000000');
    expect(quoteUSDC('1.00', rate)).toBe('0.0206016');
  });

  it('asks SEP-38 /price for 1 USDC → TRY in the sep6 context, refusing redirects', async () => {
    const { provider, fetchFn } = setup();
    await provider.getRate();

    const [url, init] = fetchFn.mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe('https://tr-mock-anchor.fly.dev/sep38/price');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sell_asset: `stellar:USDC:${ISSUER}`,
      buy_asset: 'iso4217:TRY',
      sell_amount: '1',
      context: 'sep6',
    });
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('fetches a fresh price on every call, but re-reads stellar.toml only hourly', async () => {
    const { provider, resolveToml, fetchFn, tick } = setup();
    await provider.getRate();
    await provider.getRate();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(resolveToml).toHaveBeenCalledTimes(1);

    tick(3_600_000);
    await provider.getRate();
    expect(resolveToml).toHaveBeenCalledTimes(2);
  });

  it('records no spread (but still prices) when the fee is not stated in USDC', async () => {
    const { provider } = setup({ response: priceBody({ fee: { total: '0.25', asset: 'iso4217:TRY' } }) });
    const q = await provider.getRate();
    expect(q.rate).toBe('48.540000');
    expect(q.spread).toBeNull();
  });

  describe('fails loudly — FxUnavailableError, never a fallback rate', () => {
    const cases: [string, Parameters<typeof setup>[0], RegExp][] = [
      ['stellar.toml unreachable', { toml: new Error('timeout of 20000ms exceeded') }, /stellar\.toml unreadable: timeout/],
      ['another network', { toml: { ...RECORDED_TOML, NETWORK_PASSPHRASE: Networks.PUBLIC } }, /NETWORK_PASSPHRASE/],
      ['no quote server', { toml: { NETWORK_PASSPHRASE: Networks.TESTNET } }, /no https ANCHOR_QUOTE_SERVER/],
      ['http quote server', { toml: { ...RECORDED_TOML, ANCHOR_QUOTE_SERVER: 'http://tr-mock-anchor.fly.dev/sep38' } }, /no https/],
      ['network error', { response: new TypeError('fetch failed') }, /unreachable: fetch failed/],
      ['timeout', { response: new DOMException('The operation was aborted due to timeout', 'TimeoutError') }, /unreachable/],
      ['HTTP 500', { response: new Response('oops', { status: 500 }) }, /HTTP 500/],
      ['HTTP 401 (JWT demanded)', { response: new Response('{}', { status: 401 }) }, /HTTP 401/],
      ['not JSON', { response: new Response('<html>', { status: 200 }) }, /not JSON/],
      ['huge body', { response: new Response('x'.repeat(70_000), { status: 200 }) }, /too large/],
      ['no total_price', { response: priceBody({ total_price: undefined }) }, /total_price/],
      ['total_price 0', { response: priceBody({ total_price: '0' }) }, /total_price/],
      ['total_price as a number', { response: priceBody({ total_price: 0.0206015657 }) }, /total_price/],
      ['total_price in exponent form', { response: priceBody({ total_price: '2.06e-2' }) }, /total_price/],
      ['no price', { response: priceBody({ price: null }) }, /price/],
      ['other sell_amount', { response: priceBody({ sell_amount: '100.0000000' }) }, /sell_amount/],
      ['absurd total_price', { response: priceBody({ total_price: '99999999' }) }, /zero rate/],
    ];

    it.each(cases)('%s', async (_, opts, message) => {
      const { provider } = setup(opts);
      const err = await provider.getRate().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FxUnavailableError);
      expect((err as Error).message).toMatch(message);
    });

    it('does not reuse the previous rate when the next fetch fails', async () => {
      const { provider, fetchFn } = setup();
      await provider.getRate();
      fetchFn.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(provider.getRate()).rejects.toBeInstanceOf(FxUnavailableError);
    });
  });
});
