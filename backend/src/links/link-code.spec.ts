import { LINK_CODE_ALPHABET, generateLinkCode, normalizeLinkCode } from './link-code';

describe('generateLinkCode', () => {
  it('returns 8 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateLinkCode();
      expect(code).toHaveLength(8);
      for (const ch of code) expect(LINK_CODE_ALPHABET).toContain(ch);
    }
  });

  it('never uses 0, O, 1 or I', () => {
    expect(LINK_CODE_ALPHABET).not.toMatch(/[0O1I]/);
  });
});

describe('normalizeLinkCode', () => {
  it('is case-insensitive', () => expect(normalizeLinkCode('k7q2m9xa')).toBe('K7Q2M9XA'));
  it.each(['K7Q2M9X', 'K7Q2M9XAB', 'K7Q2M9X0', 'K7Q2-9XA', ''])('rejects %j', (v) => expect(normalizeLinkCode(v)).toBeNull());
});
