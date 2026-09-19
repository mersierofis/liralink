import { toInboundOp } from './horizon-payment';

describe('toInboundOp', () => {
  it('uses destination_amount for path_payment_strict_send', () => {
    const op = toInboundOp({
      id: '1',
      paging_token: '1-1',
      type: 'path_payment_strict_send',
      from: 'GFROM',
      to: 'GTO',
      amount: '10.0000000',
      destination_amount: '9.5000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: 'GISSUER',
      transaction_hash: 'abc',
      ledger_attr: 7,
      transaction: { memo_type: 'text', memo_bytes: 'SzdRMk05SEE=' },
    });
    expect(op?.amount).toBe('9.5000000');
    expect(op?.memoBytes).toBe('SzdRMk05SEE=');
  });

  it('ignores non-payment types', () => {
    expect(
      toInboundOp({
        id: '1',
        paging_token: '1',
        type: 'create_account',
        transaction_hash: 'x',
      }),
    ).toBeNull();
  });
});
