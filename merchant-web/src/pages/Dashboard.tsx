import { Link } from 'react-router-dom'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { BalanceCard } from '@/components/BalanceCard'
import { RecentPayments } from '@/components/RecentPayments'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { CreateLinkDialog } from '@/components/CreateLinkDialog'
import { LinkCreatedDialog } from '@/components/LinkCreatedDialog'
import { VerificationBanner } from '@/components/VerificationBanner'
import { useAuth } from '@/auth/AuthProvider'
import { useBalance, useLinks, usePayments } from '@/api/hooks'
import { HttpError } from '@/api/client'
import { useState } from 'react'
import type { PaymentLink } from '@/api/types'

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

export default function DashboardPage() {
  useDocumentTitle('Dashboard')
  const { merchant } = useAuth()
  const [createdLink, setCreatedLink] = useState<PaymentLink | null>(null)

  const balance = useBalance()
  const payments = usePayments({ limit: 5 })
  const links = useLinks({ limit: 100 })

  const weekAgo = Date.now() - ONE_WEEK_MS
  const linksThisWeek = links.data?.items.filter((l) => new Date(l.createdAt).getTime() >= weekAgo) ?? []
  const openThisWeek = linksThisWeek.filter((l) => l.status === 'open' || l.status === 'underpaid').length
  const paidThisWeek = linksThisWeek.filter((l) => l.status === 'paid').length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Welcome back, {merchant?.businessName}</h1>
          <p className="text-sm text-muted-foreground">{merchant?.email}</p>
        </div>
        <CreateLinkDialog onCreated={setCreatedLink} />
      </div>

      <VerificationBanner />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          {balance.isError ? (
            <ErrorState
              message={balance.error instanceof HttpError ? balance.error.message : 'Could not load your balance.'}
              onRetry={() => balance.refetch()}
            />
          ) : (
            <BalanceCard balance={balance.data} isLoading={balance.isLoading} settlementMode={merchant?.settlementMode} />
          )}
        </div>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>This week</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-6">
            <div>
              <p className="text-2xl font-semibold">{links.isLoading ? '—' : openThisWeek}</p>
              <p className="text-xs text-muted-foreground">Open links</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{links.isLoading ? '—' : paidThisWeek}</p>
              <p className="text-xs text-muted-foreground">Paid links</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Recent payments</CardTitle>
            <CardDescription>Last 5 transfers matched to your links.</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/payments">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {payments.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {payments.isError && (
            <ErrorState
              message={payments.error instanceof HttpError ? payments.error.message : 'Could not load payments.'}
              onRetry={() => payments.refetch()}
            />
          )}
          {!payments.isLoading && !payments.isError && payments.data && payments.data.items.length === 0 && (
            <EmptyState title="No payments yet" description="They'll show up here as soon as a customer pays." />
          )}
          {!payments.isLoading && !payments.isError && payments.data && payments.data.items.length > 0 && (
            <RecentPayments payments={payments.data.items} />
          )}
        </CardContent>
      </Card>

      <LinkCreatedDialog link={createdLink} onOpenChange={(open) => !open && setCreatedLink(null)} />
    </div>
  )
}
