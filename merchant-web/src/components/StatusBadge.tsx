import { Badge } from '@/components/ui/badge'
import type { LinkStatus } from '@/api/types'

const STATUS_CONFIG: Record<LinkStatus, { label: string; variant: 'success' | 'warning' | 'secondary' | 'outline' | 'destructive' }> = {
  open: { label: 'Open', variant: 'secondary' },
  underpaid: { label: 'Underpaid', variant: 'warning' },
  paid: { label: 'Paid', variant: 'success' },
  expired: { label: 'Expired', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
}

export function StatusBadge({ status }: { status: LinkStatus }) {
  const { label, variant } = STATUS_CONFIG[status]
  return <Badge variant={variant}>{label}</Badge>
}
