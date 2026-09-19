import { randomInt } from 'node:crypto';

/** 8 characters, no 0/O/1/I (01-BACKEND.md). The code is also the tx memo and the invoice code. */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LENGTH = 8;
const LINK_CODE = new RegExp(`^[${LINK_CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`);

export function generateLinkCode(): string {
  let code = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i++) code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  return code;
}

/** `:code` is case-insensitive. Returns the canonical code, or null if it cannot be a link code. */
export function normalizeLinkCode(raw: string): string | null {
  const code = raw.toUpperCase();
  return LINK_CODE.test(code) ? code : null;
}
