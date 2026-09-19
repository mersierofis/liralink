import { Check, Loader2, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatTRY, formatUSDC, formatUSDCFull } from '@/lib/money'
import { formatDateTime } from '@/lib/format'
import type { Settlement, SettleStatus } from '@/api/types'

const STEPS: { status: Exclude<SettleStatus, 'failed'>; label: string }[] = [
  { status: 'pending', label: 'Queued' },
  { status: 'processing', label: 'Converting' },
  { status: 'completed', label: 'Credited' },
]

const ORDER: Record<SettleStatus, number> = { pending: 0, processing: 1, completed: 2, failed: -1 }

/**
 * pending -> processing -> completed for one settlement. A `failed` settlement is terminal and
 * never retried (00-PROJECT.md §5): it is drawn as the step it stopped at, in red.
 * `net TRY` and the fee only exist once completed (both are null until then).
 */
export function SettlementTimeline({ settlement }: { settlement: Settlement }) {
  const failed = settlement.status === 'failed'
  // A failed settlement has no recorded step, so the whole track is drawn as stopped.
  const reached = failed ? 0 : ORDER[settlement.status]

  return (
    <div className="space-y-3">
      <ol className="flex items-center gap-2" aria-label="Settlement progress">
        {STEPS.map((step, i) => {
          const done = i < reached || (i === reached && settlement.status === 'completed')
          const current = i === reached && !done && !failed
          const stopped = failed && i === reached
          return (
            <li key={step.status} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs transition-colors duration-500',
                  done && 'border-emerald-600 bg-emerald-600 text-white',
                  current && 'border-amber-500 text-amber-600',
                  stopped && 'border-destructive bg-destructive text-destructive-foreground',
                  !done && !current && !stopped && 'border-muted-foreground/30 text-muted-foreground/50',
                )}
              >
                {done && <Check className="h-3.5 w-3.5" />}
                {current && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {stopped && <X className="h-3.5 w-3.5" />}
              </span>
              <span className={cn('text-sm', done || current ? 'font-medium' : 'text-muted-foreground')}>
                {step.label}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  className={cn(
                    'h-px flex-1 transition-colors duration-500',
                    i < reached ? 'bg-emerald-600' : 'bg-muted-foreground/20',
                  )}
                />
              )}
            </li>
          )
        })}
      </ol>

      {failed && (
        <p className="text-sm text-destructive">
          Settlement failed{settlement.failReason ? ` (${settlement.failReason})` : ''}. It will not be retried.
        </p>
      )}

      {settlement.status === 'completed' && settlement.netTRY && (
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Credited</dt>
            <dd className="font-medium">{formatTRY(settlement.netTRY)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Anchor fee</dt>
            <dd title={settlement.feeUSDC ? formatUSDCFull(settlement.feeUSDC) : undefined}>
              {settlement.feeUSDC ? formatUSDC(settlement.feeUSDC) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Completed</dt>
            <dd>{settlement.completedAt ? formatDateTime(settlement.completedAt) : '—'}</dd>
          </div>
        </dl>
      )}
    </div>
  )
}
