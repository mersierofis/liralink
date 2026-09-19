import { Skeleton } from '@/components/ui/skeleton'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PaymentsTable } from '@/components/PaymentsTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { usePayments } from '@/api/hooks'
import { HttpError } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'

export default function PaymentsPage() {
  useDocumentTitle('Payments')
  const { merchant } = useAuth()
  const { data, isLoading, isError, error, refetch } = usePayments({ limit: 50 })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Payments</h1>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState message={error instanceof HttpError ? error.message : 'Could not load payments.'} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && data && data.items.length === 0 && (
        <EmptyState title="No payments yet" description="Payments appear here as soon as a customer pays a link." />
      )}

      {!isLoading && !isError && data && data.items.length > 0 && (
        <PaymentsTable payments={data.items} settlementMode={merchant?.settlementMode} />
      )}
    </div>
  )
}
