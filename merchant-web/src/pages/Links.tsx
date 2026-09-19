import { useState } from 'react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { toast } from 'sonner'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { CreateLinkDialog } from '@/components/CreateLinkDialog'
import { LinkCreatedDialog } from '@/components/LinkCreatedDialog'
import { LinksTable } from '@/components/LinksTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { useLinks, type LinksFilter } from '@/api/hooks'
import { HttpError } from '@/api/client'
import type { PaymentLink } from '@/api/types'

const STATUS_FILTERS: { value: NonNullable<LinksFilter['status']>; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'underpaid', label: 'Underpaid' },
  { value: 'paid', label: 'Paid' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function LinksPage() {
  useDocumentTitle('Links')
  const [status, setStatus] = useState<NonNullable<LinksFilter['status']>>('all')
  const [qrLink, setQrLink] = useState<PaymentLink | null>(null)
  const [createdLink, setCreatedLink] = useState<PaymentLink | null>(null)

  const { data, isLoading, isError, error, refetch } = useLinks({ status, limit: 50 })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Links</h1>
        <CreateLinkDialog
          onCreated={(link) => {
            setCreatedLink(link)
            toast.success('Link created')
          }}
        />
      </div>

      <Select value={status} onValueChange={(v) => setStatus(v as NonNullable<LinksFilter['status']>)}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_FILTERS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          message={error instanceof HttpError ? error.message : 'Could not load links.'}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !isError && data && data.items.length === 0 && (
        <EmptyState title="No links yet" description="Create your first payment link to get started." />
      )}

      {!isLoading && !isError && data && data.items.length > 0 && (
        <LinksTable links={data.items} onShowQr={setQrLink} />
      )}

      <LinkCreatedDialog link={createdLink} onOpenChange={(open) => !open && setCreatedLink(null)} />
      <LinkCreatedDialog link={qrLink} onOpenChange={(open) => !open && setQrLink(null)} title="Payment link" />
    </div>
  )
}
