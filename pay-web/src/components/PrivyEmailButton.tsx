import { lazy, Suspense, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isPrivyEnabled } from '@/privy/enabled'

export type PrivySession = {
  /** Set only once the wallet is on the ledger with a USDC trustline; null while signing in or setting up. */
  address: string | null
  signHash: (hashHex: string) => Promise<{ address: string; signature: string }>
  /** USDC held by the wallet; null until it is set up. Refreshed while it cannot cover the amount. */
  usdcBalance: string | null
}

function PrivyLoadFailed() {
  return (
    <p className="text-center text-xs text-destructive">
      Could not load email sign-in. Check your connection and reload, or pay with a wallet.
    </p>
  )
}

// Separate chunk: the Privy SDK is only fetched after the payer taps "Sign in with email".
// A failed fetch (flaky venue wifi) shows a message instead of unmounting the pay page.
const PrivyEmailFlow = lazy(() =>
  import('@/privy/PrivyEmailFlow').catch(() => ({ default: PrivyLoadFailed })),
)

/** Secondary CTA under Freighter — email → Privy Stellar wallet. */
export function PrivyEmailButton({
  onSession,
  asset,
  amountUSDC,
}: {
  onSession?: (session: PrivySession) => void
  /** The link's USDC asset: the trustline the new wallet gets. */
  asset: { code: string; issuer: string }
  /** What the payer must send: Pay stays off until the wallet holds this much. */
  amountUSDC: string
}) {
  const [started, setStarted] = useState(false)
  if (!isPrivyEnabled()) return null

  if (!started) {
    return (
      <Button
        type="button"
        variant="link"
        className="h-auto w-full px-0 text-sm text-muted-foreground"
        onClick={() => setStarted(true)}
      >
        No wallet? Sign in with email
      </Button>
    )
  }

  return (
    <Suspense
      fallback={
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Loading email sign-in…
        </p>
      }
    >
      <PrivyEmailFlow onSession={onSession} asset={asset} amountUSDC={amountUSDC} />
    </Suspense>
  )
}
