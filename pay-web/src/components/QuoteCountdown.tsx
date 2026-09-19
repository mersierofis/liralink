import { useEffect, useState } from 'react'

function remainingMs(iso: string): number {
  return Math.max(0, new Date(iso).getTime() - Date.now())
}

/** mm:ss only — never multi-hour walls when expiry is far out. */
function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * On-chain links lock the quote until `expiresAt` (`quoteExpiresAt === expiresAt`).
 * Show a static lock message instead of a multi-hour countdown.
 */
export function QuoteCountdown({
  quoteExpiresAt,
  linkExpiresAt,
}: {
  quoteExpiresAt: string
  linkExpiresAt?: string
}) {
  const locked =
    Boolean(linkExpiresAt) &&
    new Date(quoteExpiresAt).getTime() === new Date(linkExpiresAt!).getTime()

  const [ms, setMs] = useState(() => remainingMs(quoteExpiresAt))

  useEffect(() => {
    if (locked) return
    setMs(remainingMs(quoteExpiresAt))
    const id = window.setInterval(() => setMs(remainingMs(quoteExpiresAt)), 1000)
    return () => window.clearInterval(id)
  }, [quoteExpiresAt, locked])

  if (locked) {
    return (
      <p className="text-xs text-muted-foreground">
        Rate locked until link expires
      </p>
    )
  }

  if (ms <= 0) {
    return <p className="text-xs text-muted-foreground">Quote expired — refresh the page for a new quote.</p>
  }

  return (
    <p className="text-xs text-muted-foreground">
      Quote refreshes in <span className="font-mono text-foreground">{formatCountdown(ms)}</span>
    </p>
  )
}
