import { bookCompletion, splitForSettlement } from './settlement-math';

describe('splitForSettlement — the gross TRY is always the link amount', () => {
  const link = { amountTRY: '5000.00', quotedUSDC: '147.0588236' };

  it('auto-save 0: everything goes to the anchor, the TRY is the link amount', () => {
    expect(splitForSettlement(link, 0)).toEqual({ amountTRY: '5000.00', savedUSDC: '0.0000000', amountUSDC: '147.0588236' });
  });

  it('auto-save 20 (acceptance scenario 31): 80 % converted, 20 % kept in USDC', () => {
    expect(splitForSettlement({ amountTRY: '1000.00', quotedUSDC: '29.4117648' }, 20)).toEqual({
      amountTRY: '800.00',
      savedUSDC: '5.8823529', // 5.88235296 rounded down
      amountUSDC: '23.5294119', // gets the remainder: saved + sent === quoted, to the stroop
    });
  });

  it('rounds the TRY down to the kuruş', () => {
    expect(splitForSettlement({ amountTRY: '33.33', quotedUSDC: '1.0000000' }, 10).amountTRY).toBe('29.99'); // 29.997
  });

  it('refuses a percentage outside 0–50', () => {
    expect(() => splitForSettlement(link, 51)).toThrow();
    expect(() => splitForSettlement(link, -1)).toThrow();
  });
});

describe('bookCompletion — how the money is booked (anchor.md)', () => {
  const s = { amountTRY: '50.00', amountUSDC: '1.0300783' };

  it('the anchor reports the TRY it paid: netTRY = amount_out, feeUSDC 0 (the TRY fee is already inside)', () => {
    expect(bookCompletion(s, { amountOutTRY: '49.75', feeUSDC: null })).toEqual({ feeUSDC: '0.0000000', netTRY: '49.75' });
  });

  it('amount_out with more precision is rounded down to the kuruş', () => {
    expect(bookCompletion(s, { amountOutTRY: '49.759', feeUSDC: null })).toEqual({ feeUSDC: '0.0000000', netTRY: '49.75' });
  });

  it('a fee in our USDC: netTRY = amountTRY × (amountUSDC − fee) / amountUSDC, rounded down', () => {
    expect(bookCompletion({ amountTRY: '5000.00', amountUSDC: '147.0588236' }, { amountOutTRY: null, feeUSDC: '0.0000000' })).toEqual({
      feeUSDC: '0.0000000',
      netTRY: '5000.00',
    });
    expect(bookCompletion({ amountTRY: '5000.00', amountUSDC: '147.0588236' }, { amountOutTRY: null, feeUSDC: '0.7352941' })).toEqual({
      feeUSDC: '0.7352941',
      netTRY: '4975.00', // 4975.0000006… rounded down (checked with Python's decimal)
    });
  });

  it('a fee above the amount → invalid_fee; neither a TRY amount nor a USDC fee → unexpected_fee_asset', () => {
    expect(bookCompletion(s, { amountOutTRY: null, feeUSDC: '2.0000000' })).toEqual({ failReason: 'invalid_fee' });
    expect(bookCompletion(s, { amountOutTRY: null, feeUSDC: '-1' })).toEqual({ failReason: 'invalid_fee' });
    expect(bookCompletion(s, { amountOutTRY: null, feeUSDC: null })).toEqual({ failReason: 'unexpected_fee_asset' });
  });
});
