import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { INVOICE_ERROR, contractErrorCode, deadlineLedgerFor, parsePaidEvent, stroopsToUSDC, usdcToStroops } from './invoice-contract';

const PAYER = Keypair.random().publicKey();
const PLATFORM = Keypair.random().publicKey();

/** A `paid` event exactly as the contract emits it: topics [symbol, symbol], data a map. */
function paidEvent(over: Partial<{ name: string; code: string; amount: bigint; ok: boolean; topic: xdr.ScVal[] }> = {}) {
  return {
    id: '0004815564115959808-0000000001',
    txHash: 'a'.repeat(64),
    ledger: 1_121_234,
    ledgerClosedAt: '2026-09-19T14:00:05Z',
    inSuccessfulContractCall: over.ok ?? true,
    topic: over.topic ?? [nativeToScVal(over.name ?? 'paid', { type: 'symbol' }), nativeToScVal(over.code ?? 'K7Q2M9XA', { type: 'symbol' })],
    value: nativeToScVal(
      { amount: over.amount ?? 1_470_588_236n, merchant: new Address(PLATFORM), payer: new Address(PAYER) },
      { type: { amount: ['symbol', 'i128'], merchant: ['symbol', 'address'], payer: ['symbol', 'address'] } },
    ),
  };
}

describe('USDC ⇄ stroops', () => {
  it('converts a 7-dp decimal exactly, both ways', () => {
    expect(usdcToStroops('147.0588236')).toBe(1_470_588_236n);
    expect(usdcToStroops('0.0000001')).toBe(1n);
    expect(usdcToStroops('1.5')).toBe(15_000_000n); // fewer dp is scaled, not read as stroops
    expect(usdcToStroops('12')).toBe(120_000_000n);
    expect(stroopsToUSDC(1_470_588_236n)).toBe('147.0588236');
    expect(stroopsToUSDC(1n)).toBe('0.0000001');
    expect(stroopsToUSDC(0n)).toBe('0.0000000');
  });

  it('refuses more than 7 dp, signs and exponents instead of rounding them', () => {
    expect(() => usdcToStroops('1.00000001')).toThrow();
    expect(() => usdcToStroops('1e5')).toThrow();
    expect(() => usdcToStroops('-1.0000000')).toThrow();
    expect(() => stroopsToUSDC(-1n)).toThrow();
  });
});

describe('deadlineLedgerFor', () => {
  const now = new Date('2026-09-19T12:00:00Z');

  it('puts the deadline at or before expiresAt (6 s per ledger, testnet closes every ~5 s)', () => {
    const in24h = new Date(now.getTime() + 24 * 3_600_000);
    expect(deadlineLedgerFor(in24h, now, 1_000_000)).toBe(1_000_000 + 14_400);
  });

  it('never goes below the current ledger for an already-expired time', () => {
    expect(deadlineLedgerFor(new Date(now.getTime() - 60_000), now, 1_000_000)).toBe(1_000_000);
  });
});

describe('parsePaidEvent', () => {
  it('decodes a paid event: code, payer, payout address, amount and when it happened', () => {
    expect(parsePaidEvent(paidEvent())).toEqual({
      eventId: '0004815564115959808-0000000001',
      txHash: 'a'.repeat(64),
      ledger: 1_121_234,
      paidAt: new Date('2026-09-19T14:00:05Z'),
      code: 'K7Q2M9XA',
      payer: PAYER,
      merchant: PLATFORM,
      amountUSDC: '147.0588236',
    });
  });

  it('ignores other events, failed calls and malformed topics', () => {
    expect(parsePaidEvent(paidEvent({ name: 'created' }))).toBeNull();
    expect(parsePaidEvent(paidEvent({ name: 'cancelled' }))).toBeNull();
    expect(parsePaidEvent(paidEvent({ ok: false }))).toBeNull();
    expect(parsePaidEvent(paidEvent({ topic: [nativeToScVal('paid', { type: 'symbol' })] }))).toBeNull();
  });
});

describe('contractErrorCode', () => {
  it('reads the invoice error out of a simulation failure', () => {
    expect(contractErrorCode('HostError: Error(Contract, #1)\n\nEvent log (newest first): …')).toBe(INVOICE_ERROR.AlreadyExists);
    expect(contractErrorCode('HostError: Error(Contract, #4)')).toBe(INVOICE_ERROR.Expired);
  });

  it('is null for errors that are not the contract’s own', () => {
    expect(contractErrorCode('HostError: Error(Auth, InvalidAction)')).toBeNull();
    expect(contractErrorCode('HostError: Error(Contract, #99)')).toBeNull();
    expect(contractErrorCode('timeout of 10000ms exceeded')).toBeNull();
  });
});
