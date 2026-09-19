import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { VerificationButton } from '@/components/VerificationButton'
import { usePayments } from '@/api/hooks'
import { findAwaitingVerification } from '@/lib/payments'
import { formatTRY } from '@/lib/money'

/**
 * Surfaces every settlement waiting on the merchant's SEP-24 verification prominently — not just
 * deep in the payments table (04-BACKEND-HANDOFF.md §5: "surface the button prominently, e.g. a
 * dashboard banner"). The anchor's token is short-lived (testanchor: ~15 min from when the
 * settlement started), so this needs to be hard to miss.
 */
export function VerificationBanner() {
  const { data } = usePayments({ limit: 100 })
  const awaiting = findAwaitingVerification(data?.items ?? [])

  if (awaiting.length === 0) return null

  return (
    <Alert className="border-warning/50 bg-warning/10">
      <AlertTriangle className="h-4 w-4 text-warning-foreground" />
      <AlertTitle>
        {awaiting.length === 1 ? '1 payment needs verification' : `${awaiting.length} payments need verification`}
      </AlertTitle>
      <AlertDescription>
        <p className="mb-3">
          Your anchor is waiting for you to complete a form before it can settle this payment. Links
          expire roughly 15 minutes after the payment landed — do this promptly.
        </p>
        <div className="space-y-2">
          {awaiting.map((payment) => (
            <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2">
              <div className="min-w-0">
                <Link to={`/links/${payment.linkId}`} className="font-medium hover:underline">
                  {payment.link.title}
                </Link>
                <p className="text-xs text-muted-foreground">{formatTRY(payment.link.amountTRY)}</p>
              </div>
              {payment.settlement?.interactiveUrl && <VerificationButton url={payment.settlement.interactiveUrl} />}
            </div>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  )
}
