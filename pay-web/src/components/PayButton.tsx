import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatUSDCDisplay } from '@/stellar/format'

/**
 * When contract rail is active: primary = Pay via contract, secondary = memo fallback.
 * Otherwise a single memo Pay button.
 */
export function PayButton({
  amountUSDC,
  disabled,
  loading,
  loadingRail,
  hasContractRail,
  onPayMemo,
  onPayContract,
}: {
  amountUSDC: string
  disabled?: boolean
  loading?: boolean
  loadingRail?: 'memo' | 'contract' | null
  hasContractRail?: boolean
  onPayMemo: () => void
  onPayContract?: () => void
}) {
  if (hasContractRail && onPayContract) {
    return (
      <div className="space-y-2">
        <Button
          type="button"
          className="w-full"
          size="lg"
          disabled={disabled || loading}
          onClick={onPayContract}
        >
          {loadingRail === 'contract' ? <Loader2 className="animate-spin" /> : null}
          {loadingRail === 'contract'
            ? 'Signing contract…'
            : `Pay ${formatUSDCDisplay(amountUSDC)} USDC via contract`}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          size="lg"
          disabled={disabled || loading}
          onClick={onPayMemo}
        >
          {loadingRail === 'memo' ? <Loader2 className="animate-spin" /> : null}
          {loadingRail === 'memo' ? 'Signing…' : 'Pay with memo (fallback)'}
        </Button>
      </div>
    )
  }

  return (
    <Button
      type="button"
      className="w-full"
      size="lg"
      disabled={disabled || loading}
      onClick={onPayMemo}
    >
      {loading ? <Loader2 className="animate-spin" /> : null}
      {loading ? 'Signing…' : `Pay ${formatUSDCDisplay(amountUSDC)} USDC`}
    </Button>
  )
}
