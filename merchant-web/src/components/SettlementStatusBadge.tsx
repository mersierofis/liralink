import { Badge } from '@/components/ui/badge'
import { VerificationButton } from '@/components/VerificationButton'
import { describeUnsettledPayment } from '@/lib/payments'
import type { PaymentWithLink, SettleStatus } from '@/api/types'

const CONFIG: Record<SettleStatus, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  processing: { label: 'Processing', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
}

/**
 * `payment.settlement` is null for an installment that didn't complete its link
 * (04-BACKEND-HANDOFF.md gotcha #5) — labelled from the link's current status/totals via
 * describeUnsettledPayment, never guessed from other rows on the page.
 *
 * A `processing` settlement with a non-null `interactiveUrl` means a real (sep24) anchor is
 * waiting on the merchant to complete its KYC/bank-details form — label it "Verification
 * needed" instead of "Processing" and offer the button right there (04-BACKEND-HANDOFF.md §5).
 */
export function SettlementStatusBadge({ payment }: { payment: PaymentWithLink }) {
  if (!payment.settlement) {
    const { label, detail } = describeUnsettledPayment(payment)
    return (
      <Badge variant="outline" title={detail}>
        {label}
      </Badge>
    )
  }
  const { status, failReason, interactiveUrl } = payment.settlement

  if (status === 'processing' && interactiveUrl) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="warning">Verification needed</Badge>
        <VerificationButton url={interactiveUrl} />
      </div>
    )
  }

  const { label, variant } = CONFIG[status]
  return (
    <Badge variant={variant} title={status === 'failed' && failReason ? `Reason: ${failReason}` : undefined}>
      {label}
    </Badge>
  )
}
