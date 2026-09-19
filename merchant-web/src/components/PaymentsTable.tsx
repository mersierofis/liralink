import { Decimal } from 'decimal.js'
import { Link } from 'react-router-dom'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SettlementStatusBadge } from '@/components/SettlementStatusBadge'
import { ExplorerLink } from '@/components/ExplorerLink'
import { formatTRY, formatUSDC, formatUSDCFull } from '@/lib/money'
import { formatDateTime } from '@/lib/format'
import { describeUnsettledPayment } from '@/lib/payments'
import type { PaymentWithLink, SettlementMode } from '@/api/types'

function CreditedAmount({ payment }: { payment: PaymentWithLink }) {
  if (!payment.settlement) {
    return <span className="text-sm italic text-muted-foreground" title={describeUnsettledPayment(payment).detail}>—</span>
  }
  if (payment.settlement.netTRY === null) {
    return <span className="text-sm text-muted-foreground">—</span>
  }
  const fee = new Decimal(payment.settlement.feeUSDC ?? '0')
  return (
    <span title={fee.gt(0) ? `Anchor fee: ${formatUSDC(payment.settlement.feeUSDC!)}` : undefined}>
      {formatTRY(payment.settlement.netTRY)}
    </span>
  )
}

export function PaymentsTable({ payments, settlementMode }: { payments: PaymentWithLink[]; settlementMode?: SettlementMode }) {
  const isAutoPayout = settlementMode === 'auto_payout'
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Link</TableHead>
          <TableHead>USDC received</TableHead>
          <TableHead>FX rate</TableHead>
          <TableHead>{isAutoPayout ? 'Paid to IBAN' : 'TRY credited'}</TableHead>
          <TableHead>Settlement</TableHead>
          <TableHead className="text-right">Tx</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((payment) => (
          <TableRow key={payment.id}>
            <TableCell className="text-sm text-muted-foreground">{formatDateTime(payment.detectedAt)}</TableCell>
            <TableCell>
              <Link to={`/links/${payment.linkId}`} className="hover:underline">
                {payment.link.title}
              </Link>
              <p className="font-mono text-xs text-muted-foreground">{payment.link.code}</p>
            </TableCell>
            <TableCell title={formatUSDCFull(payment.amountUSDC)}>{formatUSDC(payment.amountUSDC)}</TableCell>
            <TableCell>{payment.settlement ? new Decimal(payment.settlement.fxRate).toFixed(2) : '—'}</TableCell>
            <TableCell>
              <CreditedAmount payment={payment} />
            </TableCell>
            <TableCell>
              <SettlementStatusBadge payment={payment} />
            </TableCell>
            <TableCell className="text-right">
              <ExplorerLink href={payment.explorerUrl}>View</ExplorerLink>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
