import { useEffect, useRef, useState } from 'react'

function remainingMs(iso: string): number {
  return Math.max(0, new Date(iso).getTime() - Date.now())
}

/** Compact countdown: days when needed, then h:mm:ss or mm:ss. */
function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (d > 0) {
    return `${d}d ${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * The FX rate is locked for the life of the link (never re-quoted).
 * Countdown is to `expiresAt` — when it hits zero the link is expired, not repriced.
 */
export function QuoteCountdown({
  expiresAt,
  onExpired,
}: {
  expiresAt: string
  onExpired?: () => void
}) {
  const [ms, setMs] = useState(() => remainingMs(expiresAt))
  const onExpiredRef = useRef(onExpired)
  onExpiredRef.current = onExpired

  useEffect(() => {
    setMs(remainingMs(expiresAt))
    const tick = () => {
      const next = remainingMs(expiresAt)
      setMs(next)
      if (next <= 0) onExpiredRef.current?.()
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [expiresAt])

  if (ms <= 0) {
    return (
      <p className="text-xs text-destructive">
        This link has expired. Ask the merchant for a new link.
      </p>
    )
  }

  return (
    <p className="text-xs text-muted-foreground">
      Link expires in <span className="font-mono text-foreground">{formatCountdown(ms)}</span>
      <span className="block mt-0.5">Rate locked — no re-price.</span>
    </p>
  )
}
