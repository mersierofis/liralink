import { toInboundOp } from './inbound-op';

// Shapes observed on testnet on 2026-09-19 (tx 24b336b3…, ledger 4759255).
const base = {
  id: '20440827398459393',
  paging_token: '20440827398459393',
  transaction_successful: true,
  type: 'payment',
  created_at: '2026-09-19T12:11:02Z',
  transaction_hash: '24b336b357cf2b083e3a708e6220cc478709cb071c5a0d1a074e9187bf8d12f9',
  asset_type: 'native',
  from: 'GC7CHEVYPR6OSS5KDZR3QWARZCPGFKGZYQR6LPIZZSSWABPLVDVY3E7E',
  to: 'GBI3KJIHTTHXHBQX2CVBUEDZG36EMOJK3KWS7ZPXHPSABVCEPD6CGYBU',
  amount: '1.0000000',
};
const tx = { memo_type: 'text', memo_bytes: 'RTNZQ0FQSzY=', created_at: '2026-09-19T12:11:02Z', successful: true };

describe('toInboundOp', () => {
  it('reads the SDK shape: transaction in transaction_attr, ledger number in ledger_attr', () => {
    const op = toInboundOp({ ...base, transaction: () => undefined, transaction_attr: { ...tx, ledger: () => undefined, ledger_attr: 4759255 } });
    expect(op).toMatchObject({ ledger: 4759255, memoType: 'text', memoBytes: 'RTNZQ0FQSzY=', assetType: 'native', amount: '1.0000000' });
    expect(op.createdAt.toISOString()).toBe('2026-09-19T12:11:02.000Z');
  });

  it('reads the raw Horizon JSON shape: transaction in transaction, ledger a number', () => {
    expect(toInboundOp({ ...base, transaction: { ...tx, ledger: 4759255 } }).ledger).toBe(4759255);
  });

  it('marks a failed transaction as unsuccessful', () => {
    expect(toInboundOp({ ...base, transaction_successful: false }).successful).toBe(false);
  });

  it('refuses a record without identity fields', () => {
    expect(() => toInboundOp({ amount: '1' })).toThrow(/without id/);
  });
});

describe('HorizonPaymentSource construction', () => {
  // The e2e suite replaces the source with a fake, so the real constructor is exercised here.
  it('accepts the http loopback URL the tests use, and https', () => {
    const { HorizonPaymentSource } = jest.requireActual('./payment-source') as typeof import('./payment-source');
    expect(() => new HorizonPaymentSource('http://127.0.0.1:9', 'GBI3KJIHTTHXHBQX2CVBUEDZG36EMOJK3KWS7ZPXHPSABVCEPD6CGYBU')).not.toThrow();
    expect(() => new HorizonPaymentSource('https://horizon-testnet.stellar.org', 'GBI3KJIHTTHXHBQX2CVBUEDZG36EMOJK3KWS7ZPXHPSABVCEPD6CGYBU')).not.toThrow();
  });
});
