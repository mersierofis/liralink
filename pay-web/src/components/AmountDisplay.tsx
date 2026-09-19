import { useCallback } from 'react'
import { formatFxRate, formatTRY, formatUSDCDisplay } from '@/stellar/format'
import type { PayQuote } from '@/api/types'
import { payAmountUSDC } from '@/api/hooks'
import { QuoteCountdown } from './QuoteCountdown'

export function AmountDisplay({
  quote,
  onLinkExpired,
}: {
  quote: PayQuote
  onLinkExpired?: () => void
}) {
  const payAmount = payAmountUSDC(quote)
  const isUnderpaid = quote.status === 'underpaid'
  const handleExpired = useCallback(() => onLinkExpired?.(), [onLinkExpired])

  return (
    <div className="space-y-2 text-center">
      <p className="text-3xl font-semibold tracking-tight">{formatTRY(quote.amountTRY)}</p>
      <p className="text-lg text-muted-foreground" title={`${payAmount} USDC`}>
        ≈ {formatUSDCDisplay(isUnderpaid ? payAmount : quote.amountUSDC)} USDC
        {isUnderpaid ? ' remaining' : ''}
      </p>
      {isUnderpaid && (
        <p className="text-sm text-warning">
          Received {formatUSDCDisplay(quote.receivedUSDC)} / {formatUSDCDisplay(quote.amountUSDC)} USDC
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        1 USDC = {formatFxRate(quote.fxRate)} TRY
      </p>
      {(quote.status === 'open' || quote.status === 'underpaid') && (
        <QuoteCountdown expiresAt={quote.expiresAt} onExpired={handleExpired} />
      )}
    </div>
  )
}
