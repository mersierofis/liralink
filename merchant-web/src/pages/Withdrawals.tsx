import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { WithdrawDialog } from '@/components/WithdrawDialog'
import { WithdrawalStatusBadge } from '@/components/WithdrawalStatusBadge'
import { UsdcWithdrawDialog } from '@/components/UsdcWithdrawDialog'
import { ExplorerLink } from '@/components/ExplorerLink'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { useAuth } from '@/auth/AuthProvider'
import { useBalance, useUsdcWithdrawals, useWithdrawals } from '@/api/hooks'
import { HttpError } from '@/api/client'
import { formatTRY, formatUSDC, formatUSDCFull } from '@/lib/money'
import { formatDateTime, shortAddress } from '@/lib/format'
import type { UsdcWdStatus } from '@/api/types'

const USDC_STATUS: Record<UsdcWdStatus, { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
  submitted: { label: 'Submitted', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
}

export default function WithdrawalsPage() {
  const { merchant } = useAuth()
  const balance = useBalance()
  const withdrawals = useWithdrawals({ limit: 50 })
  const usdcWithdrawals = useUsdcWithdrawals({ limit: 50 })
  const isAutoPayout = merchant?.settlementMode === 'auto_payout'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{isAutoPayout ? 'Payouts' : 'Withdrawals'}</h1>
        {!isAutoPayout && balance.data && <WithdrawDialog availableTRY={balance.data.availableTRY} defaultIban={merchant?.iban} />}
      </div>

      {balance.isError ? (
        <ErrorState
          message={balance.error instanceof HttpError ? balance.error.message : 'Could not load your balance.'}
          onRetry={() => balance.refetch()}
        />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{isAutoPayout ? 'Paid out to your IBAN' : 'Available to withdraw'}</CardDescription>
            {balance.isLoading ? (
              <Skeleton className="h-9 w-40" />
            ) : (
              <CardTitle className="text-3xl">
                {formatTRY((isAutoPayout ? balance.data?.paidOutTRY : balance.data?.availableTRY) ?? '0.00')}
              </CardTitle>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Pending: {formatTRY(balance.data?.pendingTRY ?? '0.00')}</p>
            {isAutoPayout && (
              <p className="mt-1 text-sm text-muted-foreground">
                Your anchor pays each completed settlement straight to your IBAN — there's nothing to
                withdraw manually.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isAutoPayout && (
        <div>
          <h2 className="mb-3 text-lg font-medium">History</h2>
          {withdrawals.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {withdrawals.isError && (
            <ErrorState
              message={withdrawals.error instanceof HttpError ? withdrawals.error.message : 'Could not load withdrawals.'}
              onRetry={() => withdrawals.refetch()}
            />
          )}
          {!withdrawals.isLoading && !withdrawals.isError && withdrawals.data && withdrawals.data.items.length === 0 && (
            <EmptyState title="No withdrawals yet" description="Request one once you have an available balance." />
          )}
          {!withdrawals.isLoading && !withdrawals.isError && withdrawals.data && withdrawals.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>IBAN</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawals.data.items.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="text-sm text-muted-foreground">{formatDateTime(w.createdAt)}</TableCell>
                    <TableCell>{formatTRY(w.amountTRY)}</TableCell>
                    <TableCell className="font-mono text-xs">{w.iban}</TableCell>
                    <TableCell>
                      <WithdrawalStatusBadge status={w.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-medium">USDC to your wallet</h2>
          {balance.data && <UsdcWithdrawDialog balance={balance.data} />}
        </div>
        <p className="text-sm text-muted-foreground">
          Saved: <span title={formatUSDCFull(balance.data?.savedUSDC ?? '0.0000000')}>{formatUSDC(balance.data?.savedUSDC ?? '0')}</span>
          {' · '}Unallocated:{' '}
          <span title={formatUSDCFull(balance.data?.unallocatedUSDC ?? '0.0000000')}>{formatUSDC(balance.data?.unallocatedUSDC ?? '0')}</span>
        </p>
        {usdcWithdrawals.isLoading && <Skeleton className="h-12 w-full" />}
        {usdcWithdrawals.isError && (
          <ErrorState
            message={usdcWithdrawals.error instanceof HttpError ? usdcWithdrawals.error.message : 'Could not load USDC withdrawals.'}
            onRetry={() => usdcWithdrawals.refetch()}
          />
        )}
        {!usdcWithdrawals.isLoading && !usdcWithdrawals.isError && usdcWithdrawals.data?.items.length === 0 && (
          <EmptyState title="No USDC withdrawals yet" description="Send your Saved or Unallocated USDC to your own Stellar wallet." />
        )}
        {!usdcWithdrawals.isLoading && !usdcWithdrawals.isError && !!usdcWithdrawals.data?.items.length && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usdcWithdrawals.data.items.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(w.createdAt)}</TableCell>
                  <TableCell title={formatUSDCFull(w.amountUSDC)}>{formatUSDC(w.amountUSDC)}</TableCell>
                  <TableCell className="capitalize">{w.source}</TableCell>
                  <TableCell className="font-mono text-xs">{shortAddress(w.destination, 6, 6)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={USDC_STATUS[w.status].variant}
                      title={w.status === 'failed' && w.failReason ? `Reason: ${w.failReason} — the amount was returned to ${w.source}` : undefined}
                    >
                      {USDC_STATUS[w.status].label}
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
    </div>
  )
}
