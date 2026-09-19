import { merchantMemo } from './merchant-memo';

describe('merchantMemo', () => {
  it('is the first 63 bits of the UUID, as a decimal string (value verified against the live anchor)', () => {
    // The live SEP-10 login on 2026-09-19 issued sub "GBI3…GYBU:3413587264431399756" for this UUID.
    expect(merchantMemo('5ebeff0f-e476-4699-90dc-ae8e69f9e093')).toBe('3413587264431399756');
  });

  it('never exceeds 2^63 − 1 and is stable', () => {
    // Only the first 16 hex digits count; a v4 UUID's version nibble sits inside them.
    expect(merchantMemo('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(((1n << 63n) - 1n).toString());
    expect(merchantMemo('00000000-0000-4000-8000-000000000001')).toBe('8192'); // 0x0000000000004000 >> 1
    expect(merchantMemo('5EBEFF0F-E476-4699-90DC-AE8E69F9E093')).toBe(merchantMemo('5ebeff0f-e476-4699-90dc-ae8e69f9e093'));
  });

  it('refuses anything that is not a UUID', () => {
    expect(() => merchantMemo('merchant-1')).toThrow(/not a UUID/);
  });
});
