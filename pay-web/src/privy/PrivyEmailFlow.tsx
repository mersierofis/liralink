import { useCallback, useEffect, useRef } from 'react'
import { Loader2, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PrivySession } from '@/components/PrivyEmailButton'
import { shortAddress } from '@/stellar/format'
import { PrivyGate } from '@/privy/PrivyGate'
import { usePrivyPay } from '@/privy/usePrivyPay'

/**
 * The Privy email path, loaded with React.lazy from `PrivyEmailButton` only once the payer picks
 * email sign-in. Everything Privy (SDK, WalletConnect tree) stays out of the main bundle.
 */
export default function PrivyEmailFlow({
  onSession,
}: {
  onSession?: (session: PrivySession) => void
}) {
  return (
    <PrivyGate>
      <PrivyEmailFlowInner onSession={onSession} />
    </PrivyGate>
  )
}

function PrivyEmailFlowInner({
  onSession,
}: {
  onSession?: (session: PrivySession) => void
}) {
  const privy = usePrivyPay()
  const { startEmail } = privy

  // Privy's hooks can return new functions on any render. Handing those to the parent re-rendered
  // it, which re-rendered this flow, which produced new functions again: an infinite loop (React
  // #185). The parent gets one stable signHash that always calls the latest one, and hears about
  // the session only when the address changes.
  const signHashRef = useRef(privy.signHash)
  signHashRef.current = privy.signHash
  const signHash = useCallback((hashHex: string) => signHashRef.current(hashHex), [])

  useEffect(() => {
    onSession?.({ address: privy.address, signHash })
  }, [privy.address, signHash, onSession])

  // Mounting this chunk *is* the payer picking email sign-in: go straight to the email step.
  useEffect(() => {
    startEmail()
  }, [startEmail])

  if (!privy.ready) {
    return (
      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Loading email sign-in…
      </p>
    )
  }

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
