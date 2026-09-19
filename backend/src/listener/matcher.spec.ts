import type { InboundOp } from './inbound-op';
import { type LinkState, type MatcherConfig, applyExactAmount, classify, decide, isPayable, memoLinkCode } from './matcher';

const PLATFORM = 'GDWV6USF4R2ULWR5XW3TEUZSIRGRCU7PQWGSBDYJVIRFNAJ3LVNQ34N2';
const CIRCLE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const IMPOSTOR = 'GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6';
const PAYER = 'GDKC65WHV2UPVEUDG4ZPCJEHIW3C7KXOSZ4TV2O3GIHVDWUHVKOF26RL';
const cfg: MatcherConfig = { platformAccount: PLATFORM, usdcCode: 'USDC', usdcIssuer: CIRCLE };
const b64 = (s: string) => Buffer.from(s, 'latin1').toString('base64');

function op(patch: Partial<InboundOp> = {}): InboundOp {
  return {
    opId: '1001',
    pagingToken: '1001',
    type: 'payment',
    successful: true,
    from: PAYER,
    to: PLATFORM,
    assetType: 'credit_alphanum4',
    assetCode: 'USDC',
    assetIssuer: CIRCLE,
    amount: '147.0588236',
    txHash: 'a'.repeat(64),
    ledger: 4759000,
    createdAt: new Date('2026-09-19T12:00:00Z'),
    memoType: 'text',
    memoBytes: b64('K7Q2M9XA'),
    ...patch,
  };
}

function link(patch: Partial<LinkState> = {}): LinkState {
  return {
    id: 'link-1',
    code: 'K7Q2M9XA',
    merchantId: 'merchant-1',
    status: 'open',
    quotedUSDC: '147.0588236',
    receivedUSDC: '0.0000000',
    expiresAt: new Date('2026-09-20T12:00:00Z'),
    ...patch,
  };
}

describe('classify', () => {
  it('accepts USDC only when code AND issuer match', () => {
    expect(classify(op(), cfg)).toEqual({ kind: 'usdc', code: 'K7Q2M9XA', amount: '147.0588236' });
  });

  it('spoofed USDC — right code, wrong issuer — is wrong_asset, with the impostor recorded', () => {
    expect(classify(op({ assetIssuer: IMPOSTOR }), cfg)).toEqual({
      kind: 'wrong_asset',
      code: 'K7Q2M9XA',
      amount: '147.0588236',
      assetCode: 'USDC',
      assetIssuer: IMPOSTOR,
    });
  });

  it('USDC as a 12-character asset code is not USDC', () => {
    expect(classify(op({ assetType: 'credit_alphanum12' }), cfg).kind).toBe('wrong_asset');
  });

  it('XLM is wrong_asset with assetCode XLM and no issuer', () => {
    expect(classify(op({ assetType: 'native', assetCode: null, assetIssuer: null, amount: '10.0000000' }), cfg)).toEqual({
      kind: 'wrong_asset',
      code: 'K7Q2M9XA',
      amount: '10.0000000',
      assetCode: 'XLM',
      assetIssuer: null,
    });
  });

  it.each(['path_payment_strict_receive', 'path_payment_strict_send'])('accepts a %s (amount = what arrived)', (type) => {
    expect(classify(op({ type }), cfg).kind).toBe('usdc');
  });

  it.each([
    ['outgoing', { to: PAYER, from: PLATFORM }],
    ['not a payment', { type: 'create_account' }],
    ['failed transaction', { successful: false }],
  ])('ignores %s', (_, patch) => {
    expect(classify(op(patch as Partial<InboundOp>), cfg).kind).toBe('ignore');
  });

  it.each([
    ['no memo', { memoType: 'none', memoBytes: null }],
    ['an id memo', { memoType: 'id', memoBytes: null }],
    ['text that is not a code', { memoBytes: b64('invoice 1042') }],
    ['a lowercase code', { memoBytes: b64('k7q2m9xa') }],
    ['a code with a trailing space', { memoBytes: b64('K7Q2M9XA ') }],
    ['a code with 0/O/1/I', { memoBytes: b64('K7Q2M9X0') }],
  ])('USDC with %s is unmatched_memo', (_, patch) => {
    expect(classify(op(patch as Partial<InboundOp>), cfg)).toEqual({ kind: 'unmatched_memo', amount: '147.0588236' });
  });

  it('reads the memo from memo_bytes, never from the lossy UTF-8 memo field', () => {
    expect(memoLinkCode(op({ memoBytes: b64('K7Q2M9XA') }))).toBe('K7Q2M9XA');
    expect(memoLinkCode(op({ memoBytes: Buffer.from([0x4b, 0xff, 0x51]).toString('base64') }))).toBeNull();
  });

  it('refuses to guess a malformed amount', () => {
    expect(() => classify(op({ amount: '1e2' }), cfg)).toThrow(/not a 7-dp decimal/);
    expect(() => classify(op({ amount: '1.00000001' }), cfg)).toThrow();
    expect(() => classify(op({ amount: null }), cfg)).toThrow();
  });
});

describe('applyExactAmount', () => {
  it('received == quoted → paid', () => {
    expect(applyExactAmount('147.0588236', '0.0000000', '147.0588236')).toEqual({
      receivedUSDC: '147.0588236', status: 'paid', shortfallUSDC: null, excessUSDC: null,
    });
  });
  it('received < quoted → underpaid, with the shortfall', () => {
    expect(applyExactAmount('147.0588236', '0.0000000', '100.0000000')).toEqual({
      receivedUSDC: '100.0000000', status: 'underpaid', shortfallUSDC: '47.0588236', excessUSDC: null,
    });
  });
  it('received > quoted → paid, excess separated to the stroop', () => {
    expect(applyExactAmount('147.0588236', '0.0000000', '150.0000000')).toEqual({
      receivedUSDC: '150.0000000', status: 'paid', shortfallUSDC: null, excessUSDC: '2.9411764',
    });
  });
  it('a top-up that completes an underpaid link → paid', () => {
    expect(applyExactAmount('147.0588236', '100.0000000', '47.0588236').status).toBe('paid');
  });
  it('a top-up that overshoots → paid with only the overshoot as excess', () => {
    expect(applyExactAmount('147.0588236', '100.0000000', '50.0000000').excessUSDC).toBe('2.9411764');
  });
  it('one stroop short is still underpaid', () => {
    expect(applyExactAmount('147.0588236', '0.0000000', '147.0588235')).toMatchObject({ status: 'underpaid', shortfallUSDC: '0.0000001' });
  });
});

describe('isPayable — only a link with no payments expires, judged by payment time', () => {
  const before = new Date('2026-09-20T11:59:59Z');
  const after = new Date('2026-09-20T12:00:00Z');
  it('open: until expiresAt', () => {
    expect(isPayable(link(), before)).toBe(true);
    expect(isPayable(link(), after)).toBe(false);
  });
  it('expired by the clock, but the payment was made in time → payable', () => {
    expect(isPayable(link({ status: 'expired' }), before)).toBe(true);
    expect(isPayable(link({ status: 'expired' }), after)).toBe(false);
  });
  it('underpaid never expires', () => {
    expect(isPayable(link({ status: 'underpaid' }), new Date('2030-01-01T00:00:00Z'))).toBe(true);
  });
  it.each(['paid', 'cancelled'] as const)('%s never is', (status) => {
    expect(isPayable(link({ status }), before)).toBe(false);
  });
});

describe('decide', () => {
  const at = new Date('2026-09-19T12:00:00Z');
  const usdc = classify(op(), cfg);

  it('credits a payable link', () => {
    expect(decide(usdc, link(), at, cfg)).toMatchObject({ kind: 'credit', credit: { status: 'paid' } });
  });
  it('no link with that code → link_not_found, nothing credited', () => {
    expect(decide(usdc, null, at, cfg)).toMatchObject({ kind: 'attempt', reason: 'link_not_found', linkCode: 'K7Q2M9XA', merchantId: null });
  });
  it.each(['paid', 'cancelled'] as const)('%s link → stray (link_not_open, credited to unallocated)', (status) => {
    expect(decide(usdc, link({ status }), at, cfg)).toMatchObject({ kind: 'stray', expireLink: false });
  });
  it('open link paid after expiresAt → stray, and the link is expired in the same step', () => {
    expect(decide(usdc, link({ expiresAt: new Date('2026-09-19T11:00:00Z') }), at, cfg)).toMatchObject({ kind: 'stray', expireLink: true });
  });
  it('wrong asset names the link and merchant but credits nothing', () => {
    const xlm = classify(op({ assetType: 'native', assetCode: null, assetIssuer: null }), cfg);
    expect(decide(xlm, link(), at, cfg)).toMatchObject({ kind: 'attempt', reason: 'wrong_asset', linkCode: 'K7Q2M9XA', merchantId: 'merchant-1' });
  });
  it('unmatched memo → attempt with no link and no merchant', () => {
    const c = classify(op({ memoType: 'none', memoBytes: null }), cfg);
    expect(decide(c, null, at, cfg)).toMatchObject({ kind: 'attempt', reason: 'unmatched_memo', linkCode: null, merchantId: null });
  });
});
