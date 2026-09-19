// Recorded from https://tr-mock-anchor.fly.dev on 2026-09-19 11:26 UTC, verbatim.

/** Top-level keys of /.well-known/stellar.toml (the [DOCUMENTATION] and [[CURRENCIES]] tables omitted). */
export const RECORDED_TOML = {
  VERSION: '2.7.0',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  SIGNING_KEY: 'GDXYO6FJCNXZEWGXD54GT76FGFYLOLSOGSOJLNQ6WGHCGEQPO7NTE73M',
  WEB_AUTH_ENDPOINT: 'https://tr-mock-anchor.fly.dev/auth',
  TRANSFER_SERVER: 'https://tr-mock-anchor.fly.dev/sep6',
  KYC_SERVER: 'https://tr-mock-anchor.fly.dev/sep12',
  ANCHOR_QUOTE_SERVER: 'https://tr-mock-anchor.fly.dev/sep38',
  ACCOUNTS: ['GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6', 'GDXYO6FJCNXZEWGXD54GT76FGFYLOLSOGSOJLNQ6WGHCGEQPO7NTE73M'],
};

/** GET /sep38/price?sell_asset=stellar:USDC:GBBD…&buy_asset=iso4217:TRY&sell_amount=1&context=sep6 → 200 */
export const RECORDED_PRICE_BODY =
  '{"total_price":"0.0206015657","price":"0.0204980712","sell_amount":"1.0000000","buy_amount":"48.54","fee":{"total":"0.0050237","asset":"stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5","details":[{"name":"spread","description":"50 bps from the USD/TRY mid rate","amount":"0.0050237"}]}}';
