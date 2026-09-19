import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useRetryOnchain } from '@/api/hooks'
import { HttpError } from '@/api/client'

/**
 * Shown when a link has `onchain: null` — the on-chain invoice is created best-effort by
 * POST /links and can fail on an RPC hiccup. Without it the payer only gets the classic memo
 * rail (no "Pay via contract"). Disabled while the request runs: it takes ~5–10 s and a double
 * click must not fire it twice.
 */
export function RetryOnchainButton({ linkId }: { linkId: string }) {
  const retry = useRetryOnchain()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={retry.isPending}
        onClick={() =>
          retry.mutate(linkId, {
            onSuccess: () => toast.success('Link registered on-chain'),
            onError: (err) => toast.error(err instanceof HttpError ? err.message : 'Could not register the link on-chain.'),
          })
        }
      >
        {retry.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {retry.isPending ? 'Registering on-chain…' : 'Retry on-chain'}
      </Button>
      {retry.isPending && <span className="text-xs text-muted-foreground">This takes about 10 seconds.</span>}
    </div>
  )
}
