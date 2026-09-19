import { Link } from 'react-router-dom'

import { SettlementStatusBadge } from '@/components/SettlementStatusBadge'
import { formatTRY, formatUSDC, formatUSDCFull } from '@/lib/money'
import { formatDateTime } from '@/lib/format'
import { describeUnsettledPayment } from '@/lib/payments'
import type { PaymentWithLink } from '@/api/types'

export function RecentPayments({ payments }: { payments: PaymentWithLink[] }) {
  return (
    <ul className="divide-y">
      {payments.map((payment) => (
        <li key={payment.id} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <Link to={`/links/${payment.linkId}`} className="font-medium hover:underline">
              {payment.link.title}
            </Link>
            <p className="text-xs text-muted-foreground">{formatDateTime(payment.detectedAt)}</p>
          </div>
          <div className="flex items-center gap-3 whitespace-nowrap">
            <span className="text-sm text-muted-foreground" title={formatUSDCFull(payment.amountUSDC)}>
              {formatUSDC(payment.amountUSDC)}
            </span>
            <span className="text-sm font-medium">
              {payment.settlement ? (
                payment.settlement.netTRY !== null ? (
                  formatTRY(payment.settlement.netTRY)
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              ) : (
                <span className="italic text-muted-foreground" title={describeUnsettledPayment(payment).detail}>
                  —
                </span>
              )}
            </span>
            <SettlementStatusBadge payment={payment} />
          </div>
        </li>
      ))}
    </ul>
  )
}
