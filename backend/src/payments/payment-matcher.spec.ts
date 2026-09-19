import { memoBytesForCode, matchInbound, type InboundOp, type LinkForMatch, type MatcherConfig } from './payment-matcher';

const PLATFORM = 'GDWV6USF4R2ULWR5XW3TEUZSIRGRCU7PQWGSBDYJVIRFNAJ3LVNQ34N2';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const SPOOF = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const PAYER = 'GBRZSG7K6ZXJRCMYM2O2HO2DKR7RO2ACZ5FARBMQZBB4YZMDFDXFUTV7';
const CODE = 'K7Q2M9XA';

const cfg: MatcherConfig = {
  platformAccount: PLATFORM,
  usdcCode: 'USDC',
  usdcIssuer: ISSUER,
  now: new Date('2026-09-19T12:00:00.000Z'),
};

function op(partial: Partial<InboundOp> & Pick<InboundOp, 'amount'>): InboundOp {
  return {
    opId: partial.opId ?? 'op-1',
    type: partial.type ?? 'payment',
    from: partial.from ?? PAYER,
    to: partial.to ?? PLATFORM,
    amount: partial.amount,
    assetType: partial.assetType ?? 'credit_alphanum4',
    assetCode: partial.assetCode ?? 'USDC',
    assetIssuer: partial.assetIssuer ?? ISSUER,
    txHash: partial.txHash ?? 'a'.repeat(64),
    ledger: partial.ledger ?? 100,
    pagingToken: partial.pagingToken ?? '100-1',
    memoType: partial.memoType ?? 'text',
    memoBytes: partial.memoBytes ?? memoBytesForCode(CODE),
  };
}

function link(partial: Partial<LinkForMatch> = {}): LinkForMatch {
  return {
    id: 'link-1',
    code: CODE,
    merchantId: 'merchant-1',
    status: 'open',
    expiresAt: new Date('2026-09-20T12:00:00.000Z'),
    quotedUSDC: '10.0000000',
    receivedUSDC: '0.0000000',
    ...partial,
  };
}

describe('matchInbound', () => {
  it('credits exact amount as paid', () => {
    const d = matchInbound(op({ amount: '10.0000000' }), link(), cfg);
    expect(d).toMatchObject({
      kind: 'credit',
      status: 'paid',
      amountUSDC: '10.0000000',
      totalReceivedUSDC: '10.0000000',
      shortfallUSDC: null,
      excessUSDC: null,
    });
  });

  it('marks underpaid with shortfall', () => {
    const d = matchInbound(op({ amount: '4.0000000' }), link(), cfg);
    expect(d).toMatchObject({
      kind: 'credit',
      status: 'underpaid',
      totalReceivedUSDC: '4.0000000',
      shortfallUSDC: '6.0000000',
      excessUSDC: null,
    });
  });

  it('marks paid with excess on overpay', () => {
    const d = matchInbound(op({ amount: '12.5000000' }), link(), cfg);
    expect(d).toMatchObject({
      kind: 'credit',
      status: 'paid',
      totalReceivedUSDC: '12.5000000',
      excessUSDC: '2.5000000',
    });
  });

  it('completes an underpaid link with a second payment', () => {
    const d = matchInbound(
      op({ amount: '6.0000000', opId: 'op-2' }),
      link({ status: 'underpaid', receivedUSDC: '4.0000000' }),
      cfg,
    );
    expect(d).toMatchObject({
      kind: 'credit',
      status: 'paid',
      totalReceivedUSDC: '10.0000000',
      shortfallUSDC: null,
    });
  });

  it('keeps underpaid payable after expiresAt', () => {
    const d = matchInbound(
      op({ amount: '6.0000000' }),
      link({
        status: 'underpaid',
        receivedUSDC: '4.0000000',
        expiresAt: new Date('2026-09-18T00:00:00.000Z'),
      }),
      cfg,
    );
    expect(d.kind).toBe('credit');
  });

  it('rejects an open link past expiresAt as link_not_open + stray', () => {
    const d = matchInbound(
      op({ amount: '10.0000000' }),
      link({ expiresAt: new Date('2026-09-18T00:00:00.000Z') }),
      cfg,
    );
    expect(d).toMatchObject({
      kind: 'attempt',
      reason: 'link_not_open',
      strayUSDC: '10.0000000',
      merchantId: 'merchant-1',
    });
  });

  it('flags wrong asset (XLM)', () => {
    const d = matchInbound(
      op({ amount: '10.0000000', assetType: 'native', assetCode: null, assetIssuer: null }),
      link(),
      cfg,
    );
    expect(d).toMatchObject({ kind: 'attempt', reason: 'wrong_asset', assetCode: 'XLM', strayUSDC: null });
  });

  it('flags spoofed USDC (wrong issuer)', () => {
    const d = matchInbound(op({ amount: '10.0000000', assetIssuer: SPOOF }), link(), cfg);
    expect(d).toMatchObject({
      kind: 'attempt',
      reason: 'wrong_asset',
      assetCode: 'USDC',
      assetIssuer: SPOOF,
      strayUSDC: null,
    });
  });

  it('flags unmatched memo', () => {
    const d = matchInbound(op({ amount: '1.0000000', memoType: 'text', memoBytes: Buffer.from('hello').toString('base64') }), null, cfg);
    expect(d).toMatchObject({ kind: 'attempt', reason: 'unmatched_memo' });
  });

  it('flags link_not_found', () => {
    const d = matchInbound(op({ amount: '1.0000000' }), null, cfg);
    expect(d).toMatchObject({ kind: 'attempt', reason: 'link_not_found', linkCode: CODE });
  });

  it('accepts path_payment amounts the same way (amount already normalized)', () => {
    const d = matchInbound(op({ amount: '10.0000000', type: 'path_payment_strict_receive' }), link(), cfg);
    expect(d).toMatchObject({ kind: 'credit', status: 'paid' });
  });
});
