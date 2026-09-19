import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { WithdrawDialog } from '@/components/WithdrawDialog'
import { WithdrawalStatusBadge } from '@/components/WithdrawalStatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { useAuth } from '@/auth/AuthProvider'
import { useBalance, useWithdrawals } from '@/api/hooks'
import { HttpError } from '@/api/client'
import { formatTRY } from '@/lib/money'
import { formatDateTime } from '@/lib/format'

export default function WithdrawalsPage() {
  const { merchant } = useAuth()
  const balance = useBalance()
  const withdrawals = useWithdrawals({ limit: 50 })
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
    </div>
  )
}
