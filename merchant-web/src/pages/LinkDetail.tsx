import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/StatusBadge'
import { CopyButton } from '@/components/CopyButton'
import { ExplorerLink } from '@/components/ExplorerLink'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { SettlementStatusBadge } from '@/components/SettlementStatusBadge'
import { useLink, usePayments, useRetryOnchain, useSimulatePayment } from '@/api/hooks'
import { SettlementTimeline } from '@/components/SettlementTimeline'
import { HttpError } from '@/api/client'
import { Decimal } from 'decimal.js'

import { formatTRY, formatUSDC, formatUSDCFull } from '@/lib/money'
import { formatDateTime, shortAddress } from '@/lib/format'
import type { LinkStatus } from '@/api/types'

function formatFx(rate: string): string {
  return new Decimal(rate).toFixed(2)
}

const POLLING_STATUSES: LinkStatus[] = ['open', 'underpaid']

export default function LinkDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: link, isLoading, isError, error, refetch } = useLink(id, {
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && POLLING_STATUSES.includes(status) ? 3000 : false
    },
  })

  const simulatePayment = useSimulatePayment()
  const retryOnchain = useRetryOnchain()
  const isMock = import.meta.env.VITE_USE_MOCK === 'true'

  // No GET /settlements-for-link endpoint exists — pull it from the merchant's payments list
  // (PaymentWithLink.settlement) and filter client-side, same pattern Dashboard's "this week"
  // stats use for links. Fine at hackathon scale; would need a real filter at real volume.
  const paymentsQuery = usePayments({ limit: 100 })
  const settledPayments = (paymentsQuery.data?.items ?? []).filter((p) => p.linkId === id)

  const prevStatus = useRef<LinkStatus | undefined>(undefined)

  useEffect(() => {
    if (!link) return
    if (prevStatus.current && POLLING_STATUSES.includes(prevStatus.current) && link.status === 'paid') {
      toast.success(`Payment received · ${formatTRY(link.amountTRY)}`)
    }
    prevStatus.current = link.status
  }, [link])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (isError) {
    const notFound = error instanceof HttpError && error.statusCode === 404
    if (notFound) {
      return (
        <EmptyState
          title="Link not found"
          description="It may have been removed, or the URL is wrong."
          action={
            <Button asChild variant="outline" className="mt-2">
              <Link to="/links">Back to links</Link>
            </Button>
          }
        />
      )
    }
    return <ErrorState message={error instanceof HttpError ? error.message : 'Could not load this link.'} onRetry={() => refetch()} />
  }

  if (!link) return null

  const explorerTxBase = import.meta.env.VITE_EXPLORER_TX_URL
  const explorerAccountBase = import.meta.env.VITE_EXPLORER_ACCOUNT_URL

  return (
    <div className="space-y-6">
      <Link to="/links" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to links
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{link.title}</h1>
            <StatusBadge status={link.status} />
          </div>
          {link.description && <p className="mt-1 text-muted-foreground">{link.description}</p>}
          <p className="mt-1 font-mono text-xs text-muted-foreground">{link.code}</p>
        </div>
        <div className="flex items-center gap-2">
          {isMock && link.status === 'open' && (
            <Button
              variant="secondary"
              size="sm"
              disabled={simulatePayment.isPending}
              onClick={() => {
                simulatePayment.mutate(link.id)
                toast.info('Simulating payment… it will land in ~2s')
              }}
            >
              Simulate payment
            </Button>
          )}
          <CopyButton value={link.payUrl} label="Copy pay link" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Amount</CardDescription>
            <CardTitle className="text-xl">{formatTRY(link.amountTRY)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Quoted USDC</CardDescription>
            <CardTitle className="text-xl" title={formatUSDCFull(link.quotedUSDC)}>
              {formatUSDC(link.quotedUSDC)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{link.status === 'underpaid' ? 'Shortfall' : 'Received'}</CardDescription>
            <CardTitle className="text-xl">
              {link.status === 'underpaid' && link.shortfallUSDC ? formatUSDC(link.shortfallUSDC) : formatUSDC(link.receivedUSDC)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <p className="text-sm text-muted-foreground">
        Rate locked at {formatFx(link.fxRate)} TRY per USDC
        {link.fxSpread !== null && new Decimal(link.fxSpread).gt(0) ? ` (incl. ${link.fxSpread} spread)` : ''}, fetched{' '}
        {formatDateTime(link.fxRateAt)}. It is never re-quoted; the link expires {formatDateTime(link.expiresAt)}.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>On-chain invoice</CardTitle>
          <CardDescription>
            Lets a payer pay through the Soroban contract instead of a memo payment. Created best-effort with the link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {link.onchain ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Contract</dt>
                <dd className="flex items-center gap-1.5">
                  <span className="font-mono">{shortAddress(link.onchain.contractId, 6, 6)}</span>
                  <CopyButton value={link.onchain.contractId} label="" className="h-6 px-1.5" />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Invoice code</dt>
                <dd className="font-mono">{link.onchain.invoiceCode}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Deadline ledger</dt>
                <dd>{link.onchain.deadlineLedger}</dd>
              </div>
            </dl>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                No on-chain invoice yet. Payers can still pay with the memo payment.
              </p>
              {link.status === 'open' && link.payments.length === 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={retryOnchain.isPending}
                  onClick={async () => {
                    try {
                      await retryOnchain.mutateAsync(link.id)
                      toast.success('On-chain invoice created')
                    } catch (err) {
                      toast.error(err instanceof HttpError ? err.message : 'Could not create the on-chain invoice.')
                    }
                  }}
                >
                  {retryOnchain.isPending ? 'Creating…' : 'Retry on-chain'}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
          <CardDescription>
            {link.payments.length === 0
              ? 'No payments detected yet.'
              : `${link.payments.length} transfer${link.payments.length > 1 ? 's' : ''} matched to this link.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {link.payments.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Waiting for a payment with memo <span className="font-mono">{link.code}</span>…
            </p>
          )}
          {link.payments.map((payment) => (
            <div key={payment.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {payment.rail === 'contract' ? 'On-chain (contract)' : 'Classic (memo)'}
                  </Badge>
                  <span className="text-sm font-medium">{formatUSDC(payment.amountUSDC)}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(payment.detectedAt)}</span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Transaction</dt>
                  <dd className="flex items-center gap-1.5">
                    {explorerTxBase ? (
                      <ExplorerLink href={`${explorerTxBase}${payment.txHash}`}>{shortAddress(payment.txHash, 6, 6)}</ExplorerLink>
                    ) : (
                      <span className="font-mono">{shortAddress(payment.txHash, 6, 6)}</span>
                    )}
                    <CopyButton value={payment.txHash} label="" className="h-6 px-1.5" />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Payer</dt>
                  <dd className="flex items-center gap-1.5">
                    {explorerAccountBase ? (
                      <ExplorerLink href={`${explorerAccountBase}${payment.payerAddress}`}>{shortAddress(payment.payerAddress)}</ExplorerLink>
                    ) : (
                      <span className="font-mono">{shortAddress(payment.payerAddress)}</span>
                    )}
                    <CopyButton value={payment.payerAddress} label="" className="h-6 px-1.5" />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Ledger</dt>
                  <dd>{payment.ledger}</dd>
                </div>
              </dl>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settlement</CardTitle>
          <CardDescription>USDC → TRY conversion status for each payment on this link.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {paymentsQuery.isLoading && <Skeleton className="h-9 w-40" />}
          {!paymentsQuery.isLoading && link.payments.length === 0 && (
            <p className="text-sm text-muted-foreground">No payments yet — nothing to settle.</p>
          )}
          {!paymentsQuery.isLoading &&
            link.payments.length > 0 &&
            settledPayments.map((payment) => (
              <div key={payment.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{formatUSDC(payment.amountUSDC)}</span>
                  <SettlementStatusBadge payment={payment} />
                </div>
                {payment.settlement && <SettlementTimeline settlement={payment.settlement} />}
              </div>
            ))}
          {!paymentsQuery.isLoading && link.payments.length > 0 && settledPayments.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Settlement details aren't in the most recent 100 payments — check the Payments page.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
