import {
  formatRate,
  formatTRY,
  formatUSDC,
  isValidLinkAmountTRY,
  isValidRate,
  quoteUSDC,
} from './money';

describe('quoteUSDC', () => {
  it('divides amountTRY by the rate and rounds UP to 7 dp', () => {
    // 5000 / 34 = 147.05882352941176… → 147.0588236 (never 147.0588235: the payer must not underpay)
    expect(quoteUSDC('5000.00', '34.00')).toBe('147.0588236');
  });

  it('does not round up an exact quotient', () => {
    expect(quoteUSDC('34.00', '34')).toBe('1.0000000');
    expect(quoteUSDC('1.00', '0.5')).toBe('2.0000000');
  });

  it('rounds up a remainder far below the 7th decimal', () => {
    expect(quoteUSDC('3.00', '2.9999999')).toBe('1.0000001'); // 1.00000003333… → 1.0000001
  });

  it('handles the link bounds without losing precision', () => {
    expect(quoteUSDC('1000000.00', '34.1234567')).toBe('29305.3546361'); // checked against Python's decimal, ROUND_CEILING
    expect(quoteUSDC('1.00', '1000000')).toBe('0.0000010');
  });

  it('is exact where binary floating point is not', () => {
    // 0.3 / 0.1 is 2.9999999999999996 in floats
    expect(quoteUSDC('0.30', '0.1')).toBe('3.0000000');
  });

  it('rejects a zero rate and non-decimal input', () => {
    expect(() => quoteUSDC('10.00', '0')).toThrow();
    expect(() => quoteUSDC('1e3', '34')).toThrow();
    expect(() => quoteUSDC('-5.00', '34')).toThrow();
  });
});

describe('formatTRY / formatUSDC / formatRate', () => {
  it('pads to the fixed number of dp, zero included', () => {
    expect(formatTRY('5000')).toBe('5000.00');
    expect(formatTRY('0')).toBe('0.00');
    expect(formatUSDC('0')).toBe('0.0000000');
    expect(formatUSDC('147.05')).toBe('147.0500000');
    expect(formatRate('34')).toBe('34.0000000');
  });

  it('reads a Prisma-Decimal-like value through toFixed(), never through exponent notation', () => {
    // Prisma's Decimal prints 0.0000001 as "1e-7" from toString(); toFixed() is lossless.
    const prismaLike = { toFixed: () => '0.0000001', toString: () => '1e-7' };
    expect(formatUSDC(prismaLike)).toBe('0.0000001');
  });

  it('throws instead of silently rounding away precision', () => {
    expect(() => formatTRY('1.005')).toThrow(/more than 2 dp/);
    expect(() => formatUSDC('1.00000001')).toThrow(/more than 7 dp/);
  });

  it('rejects anything that is not a plain decimal string', () => {
    expect(() => formatUSDC('1e-7')).toThrow();
    expect(() => formatTRY('')).toThrow();
    expect(() => formatTRY('12,50')).toThrow();
  });
});

describe('isValidLinkAmountTRY', () => {
  it.each(['1.00', '5000.00', '1000000.00'])('accepts %s', (v) => expect(isValidLinkAmountTRY(v)).toBe(true));
  it.each(['0.99', '1000000.01', '5000', '5000.0', '5000.000', '-1.00', '1e3', ' 5.00', ''])('rejects %j', (v) =>
    expect(isValidLinkAmountTRY(v)).toBe(false),
  );
});

describe('isValidRate', () => {
  it.each(['34', '34.00', '0.0000001'])('accepts %s', (v) => expect(isValidRate(v)).toBe(true));
  it.each(['0', '0.00', '-34', '34.12345678', 'abc'])('rejects %j', (v) => expect(isValidRate(v)).toBe(false));
});
