import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { SendToWalletDialog } from '@/components/SendToWalletDialog'
import { useUsdcWithdrawals } from '@/api/hooks'
import { HttpError } from '@/api/client'
import type { UsdcWithdrawal } from '@/api/types'

/** Older backend without POST/GET /usdc-withdrawals (404) → no button (04-BACKEND-HANDOFF.md §5). */
export function SendToWalletButton({ source, available }: { source: UsdcWithdrawal['source']; available: string }) {
  const [open, setOpen] = useState(false)
  const { error } = useUsdcWithdrawals({ limit: 1 })
  if (error instanceof HttpError && error.statusCode === 404) return null

  return (
    <>
      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen(true)}>
        Send to my wallet
      </Button>
      <SendToWalletDialog open={open} onOpenChange={setOpen} source={source} available={available} />
    </>
  )
}
