import { lazy, Suspense, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isPrivyEnabled } from '@/privy/enabled'

export type PrivySession = {
  address: string | null
  signHash: (hashHex: string) => Promise<{ address: string; signature: string }>
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
}: {
  onSession?: (session: PrivySession) => void
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
      <PrivyEmailFlow onSession={onSession} />
    </Suspense>
  )
}
