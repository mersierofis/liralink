import { formatFxRate, formatTRY, formatUSDCDisplay } from '@/stellar/format'
import type { PayQuote } from '@/api/types'
import { payAmountUSDC } from '@/api/hooks'
import { QuoteCountdown } from './QuoteCountdown'

export function AmountDisplay({ quote }: { quote: PayQuote }) {
  const payAmount = payAmountUSDC(quote)
  const isUnderpaid = quote.status === 'underpaid'

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
      {quote.status === 'open' && (
        <QuoteCountdown quoteExpiresAt={quote.quoteExpiresAt} linkExpiresAt={quote.expiresAt} />
      )}
    </div>
  )
}
