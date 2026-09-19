import { useState } from 'react'
import { Decimal } from 'decimal.js'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SendToWalletDialog } from '@/components/SendToWalletDialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { ExplorerLink } from '@/components/ExplorerLink'
import { useUsdcWithdrawals } from '@/api/hooks'
import { HttpError } from '@/api/client'
import { formatUSDC, formatUSDCFull } from '@/lib/money'
import { formatDateTime, shortAddress } from '@/lib/format'
import type { Balance, UsdcWdStatus, UsdcWithdrawal } from '@/api/types'

const STATUS: Record<UsdcWdStatus, { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
  submitted: { label: 'Submitted', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
}

const SOURCES: { source: UsdcWithdrawal['source']; label: string; field: 'savedUSDC' | 'unallocatedUSDC' }[] = [
  { source: 'saved', label: 'Held in USD', field: 'savedUSDC' },
  { source: 'unallocated', label: 'Unallocated', field: 'unallocatedUSDC' },
]

export function UsdcWithdrawalsList({ balance }: { balance?: Balance }) {
  const { data, isLoading, isError, error, refetch } = useUsdcWithdrawals({ limit: 50 })
  const [sending, setSending] = useState<UsdcWithdrawal['source'] | null>(null)

  // Older backend without the route: nothing to show.
  if (isError && error instanceof HttpError && error.statusCode === 404) return null

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">USDC withdrawals</h2>
        <div className="flex flex-wrap gap-2">
          {SOURCES.map(({ source, label, field }) => {
            const available = balance?.[field]
            const has = available !== undefined && new Decimal(available).gt(0)
            return has ? (
              <Button key={source} variant="outline" size="sm" onClick={() => setSending(source)}>
                Send {label} to my wallet
              </Button>
            ) : null
          })}
        </div>
      </div>
      {SOURCES.map(({ source, field }) =>
        balance ? (
          <SendToWalletDialog
            key={source}
            open={sending === source}
            onOpenChange={(open) => !open && setSending(null)}
            source={source}
            available={balance[field]}
          />
        ) : null,
      )}
      {isLoading && <Skeleton className="h-12 w-full" />}
      {isError && (
        <ErrorState message={error instanceof HttpError ? error.message : 'Could not load USDC withdrawals.'} onRetry={() => refetch()} />
      )}
      {data && data.items.length === 0 && (
        <EmptyState title="No USDC withdrawals yet" description="Use “Send … to my wallet” above (or on the dashboard) to move USDC to your own Stellar wallet." />
      )}
      {data && data.items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Tx</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="text-sm text-muted-foreground">{formatDateTime(w.createdAt)}</TableCell>
                <TableCell title={formatUSDCFull(w.amountUSDC)}>{formatUSDC(w.amountUSDC)}</TableCell>
                <TableCell>{w.source === 'saved' ? 'Held in USD' : 'Unallocated'}</TableCell>
                <TableCell className="font-mono text-xs">{shortAddress(w.destination, 6, 6)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS[w.status].variant} title={w.failReason ? `Reason: ${w.failReason}` : undefined}>
                    {STATUS[w.status].label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <ExplorerLink href={w.explorerUrl}>{shortAddress(w.txHash, 4, 4)}</ExplorerLink>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
