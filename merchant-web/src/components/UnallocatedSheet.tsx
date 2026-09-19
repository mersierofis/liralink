import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { ExplorerLink } from '@/components/ExplorerLink'
import { useUnallocated } from '@/api/hooks'
import { HttpError } from '@/api/client'
import { formatUSDC, formatUSDCFull } from '@/lib/money'
import { formatDateTime, shortAddress } from '@/lib/format'

const PAGE_SIZE = 10

/**
 * Explains Balance.unallocatedUSDC: one row per credit (a 'stray' payment to a link that was no
 * longer payable, or the 'overpaid' excess on the payment that completed a link). The summary is
 * computed by the backend over all pages — shown as-is, never re-added from the rows here.
 */
export function UnallocatedSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, error, refetch } = useUnallocated(page, PAGE_SIZE, open)

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Unallocated USDC</SheetTitle>
          <SheetDescription>
            USDC that reached LiraLink but didn't settle into a link: payments to a link that was already paid,
            expired or cancelled, and the excess on overpaid links.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {isError && (
            <ErrorState
              message={error instanceof HttpError ? error.message : 'Could not load unallocated credits.'}
              onRetry={() => refetch()}
            />
          )}

          {data && (
            <>
              <dl className="grid grid-cols-3 gap-3 rounded-lg border p-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Credited</dt>
                  <dd className="font-medium" title={formatUSDCFull(data.summary.creditedUSDC)}>
                    {formatUSDC(data.summary.creditedUSDC)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Sent to your wallet</dt>
                  <dd className="font-medium" title={formatUSDCFull(data.summary.withdrawnUSDC)}>
                    {formatUSDC(data.summary.withdrawnUSDC)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Remaining</dt>
                  <dd className="font-semibold" title={formatUSDCFull(data.summary.remainingUSDC)}>
                    {formatUSDC(data.summary.remainingUSDC)}
                  </dd>
                </div>
              </dl>

              {data.items.length === 0 ? (
                <EmptyState title="Nothing unallocated" description="Every payment so far settled into its link." />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Link</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead className="text-right">Tx</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((credit) => (
                        <TableRow key={credit.id}>
                          <TableCell className="text-sm text-muted-foreground">{formatDateTime(credit.createdAt)}</TableCell>
                          <TableCell>
                            <Badge variant={credit.source === 'stray' ? 'warning' : 'secondary'}>
                              {credit.source === 'stray' ? 'Stray payment' : 'Overpayment'}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{credit.linkCode}</TableCell>
                          <TableCell title={formatUSDCFull(credit.amountUSDC)}>{formatUSDC(credit.amountUSDC)}</TableCell>
                          <TableCell className="max-w-[220px] text-xs text-muted-foreground">{credit.reason}</TableCell>
                          <TableCell className="text-right">
                            <ExplorerLink href={credit.explorerUrl}>{shortAddress(credit.txHash, 4, 4)}</ExplorerLink>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                      </span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                          Previous
                        </Button>
                        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
