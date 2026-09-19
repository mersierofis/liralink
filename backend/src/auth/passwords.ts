import { compare, hash } from 'bcryptjs';

const COST = 10; // 01-BACKEND.md

export function hashPassword(password: string): Promise<string> {
  return hash(password, COST);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

/** Byte length check: bcrypt ignores everything after 72 bytes, and multi-byte characters count more than once. */
export function fitsBcrypt(password: string): boolean {
  return Buffer.byteLength(password, 'utf8') <= 72;
}
