const tryFormatter = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })

/** amountTRY is always a 2dp decimal string from the API — render only, never do math on it. */
export function formatTRY(amountTRY: string): string {
  const n = Number(amountTRY)
  return Number.isFinite(n) ? tryFormatter.format(n) : amountTRY
}

/** USDC amounts are 7dp decimal strings from the API. Display 2dp; full precision belongs in a tooltip/title. */
export function formatUSDC(amountUSDC: string, dp = 2): string {
  const n = Number(amountUSDC)
  if (!Number.isFinite(n)) return `${amountUSDC} USDC`
  return `${n.toFixed(dp)} USDC`
}

export function formatUSDCFull(amountUSDC: string): string {
  return `${amountUSDC} USDC`
}
