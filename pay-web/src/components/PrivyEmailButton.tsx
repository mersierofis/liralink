import { useEffect } from 'react'
import { Loader2, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { shortAddress } from '@/stellar/format'
import { isPrivyEnabled } from '@/privy/PrivyGate'
import { usePrivyPay } from '@/privy/usePrivyPay'

export type PrivySession = {
  address: string | null
  signHash: (hashHex: string) => Promise<{ address: string; signature: string }>
}

/** Secondary CTA under Freighter — email → Privy Stellar wallet. */
export function PrivyEmailButton({
  onSession,
}: {
  onSession?: (session: PrivySession) => void
}) {
  if (!isPrivyEnabled()) return null
  return <PrivyEmailButtonInner onSession={onSession} />
}

function PrivyEmailButtonInner({
  onSession,
}: {
  onSession?: (session: PrivySession) => void
}) {
  const privy = usePrivyPay()

  useEffect(() => {
    onSession?.({ address: privy.address, signHash: privy.signHash })
  }, [privy.address, privy.signHash, onSession])

  if (!privy.ready) return null

  if (privy.phase === 'ready' && privy.address) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Mail className="size-4" />
            <span className="font-mono text-xs">{shortAddress(privy.address)}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              email wallet
            </span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void privy.disconnect()}>
            Sign out
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Secondary path — stage demo still uses Freighter. Kill line 01:00 if broken.
        </p>
      </div>
    )
  }

  if (privy.phase === 'email') {
    return (
      <div className="space-y-2 rounded-lg border border-dashed p-3">
        <label className="text-xs font-medium" htmlFor="privy-email">
          Email
        </label>
        <input
          id="privy-email"
          type="email"
          autoComplete="email"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={privy.email}
          onChange={(e) => privy.setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <Button
          type="button"
          className="w-full"
          variant="secondary"
          disabled={privy.busy}
          onClick={() => void privy.submitEmail()}
        >
          {privy.busy ? <Loader2 className="animate-spin" /> : null}
          Send code
        </Button>
        {privy.error ? <p className="text-xs text-destructive">{privy.error}</p> : null}
      </div>
    )
  }

  if (privy.phase === 'code') {
    return (
      <div className="space-y-2 rounded-lg border border-dashed p-3">
        <label className="text-xs font-medium" htmlFor="privy-code">
          Code from email
        </label>
        <input
          id="privy-code"
          inputMode="numeric"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={privy.code}
          onChange={(e) => privy.setCode(e.target.value)}
          placeholder="123456"
        />
        <Button
          type="button"
          className="w-full"
          variant="secondary"
          disabled={privy.busy}
          onClick={() => void privy.submitCode()}
        >
          {privy.busy ? <Loader2 className="animate-spin" /> : null}
          Verify & create Stellar wallet
        </Button>
        {privy.error ? <p className="text-xs text-destructive">{privy.error}</p> : null}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="link"
        className="h-auto w-full px-0 text-sm text-muted-foreground"
        onClick={privy.startEmail}
      >
        No wallet? Sign in with email
      </Button>
      {privy.error ? <p className="text-center text-xs text-destructive">{privy.error}</p> : null}
    </div>
  )
}
