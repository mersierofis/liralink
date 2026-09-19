/**
 * The SEP-10 memo that makes each merchant its own anchor customer (anchor.md, SEP-6 step 3):
 * the first 63 bits of the merchant's UUID, as an unsigned decimal string. A memo id is a uint64;
 * 63 bits keeps it inside a signed 64-bit integer too, for anchors that store it as one.
 *
 * NEVER change this derivation: a new formula would make every merchant a stranger to the anchor
 * (new KYC record, no history, the IBAN registered again).
 */
export function merchantMemo(merchantId: string): string {
  const hex = merchantId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`not a UUID: ${merchantId}`);
  return (BigInt(`0x${hex.slice(0, 16)}`) >> 1n).toString();
}
