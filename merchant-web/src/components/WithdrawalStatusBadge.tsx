import { Badge } from '@/components/ui/badge'
import type { WdStatus } from '@/api/types'

const CONFIG: Record<WdStatus, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' }> = {
  requested: { label: 'Requested', variant: 'secondary' },
  processing: { label: 'Processing', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
}

export function WithdrawalStatusBadge({ status }: { status: WdStatus }) {
  const { label, variant } = CONFIG[status]
  return <Badge variant={variant}>{label}</Badge>
}
