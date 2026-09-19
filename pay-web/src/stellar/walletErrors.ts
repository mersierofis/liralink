/**
 * Map only known wallet-rejection signals. Do not use a broad
 * /reject|denied|cancel|user/ regex — that swallows simulation / auth / balance errors.
 */
export function isWalletRejection(err: unknown): boolean {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = String((err as { name: unknown }).name)
    if (name === 'UserRejectedError') return true
  }
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /UserRejectedError/i.test(msg) ||
    /User rejected/i.test(msg) ||
    /User declined/i.test(msg) ||
    /Rejected by user/i.test(msg) ||
    /Request rejected/i.test(msg) ||
    /\bACTION_DECLINED\b/i.test(msg) ||
    /\bUSER_REJECTED\b/i.test(msg)
  )
}

export function walletRejectionMessage(): string {
  return 'Signature rejected in the wallet. Nothing was sent.'
}
