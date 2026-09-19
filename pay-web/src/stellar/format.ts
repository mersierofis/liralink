export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) return address
  return `${address.slice(0, chars)}…${address.slice(-chars)}`
}

/** Display USDC rounded to 2 dp; keep the original string for tooltips / tx amounts. */
export function formatUSDCDisplay(amount: string): string {
  const negative = amount.startsWith('-')
  const raw = negative ? amount.slice(1) : amount
  const [whole, frac = ''] = raw.split('.')
  const digits = (frac + '000').slice(0, 3) // 2 dp + 1 for rounding
  let cents = Number(digits.slice(0, 2))
  const next = Number(digits[2] ?? '0')
  if (next >= 5) cents += 1
  let wholeN = Number(whole)
  if (cents >= 100) {
    cents -= 100
    wholeN += 1
  }
  const out = `${wholeN}.${String(cents).padStart(2, '0')}`
  return negative ? `-${out}` : out
}

export function formatTRY(amount: string): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return `${amount} TRY`
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n)
}

export function formatFxRate(rate: string): string {
  const [whole, frac = ''] = rate.split('.')
  const trimmed = frac.replace(/0+$/, '').slice(0, 2)
  return trimmed ? `${whole}.${trimmed}` : whole
}
