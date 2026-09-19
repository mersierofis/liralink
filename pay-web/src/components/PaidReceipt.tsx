import { CheckCircle2, ExternalLink, Share2 } from 'lucide-react'
import type { PayRail, Payment, PayQuote } from '@/api/types'
import { formatTRY, formatUSDCDisplay, shortAddress } from '@/stellar/format'
import { Button } from '@/components/ui/button'
import { CopyButton } from './CopyButton'

function railLabel(rail: PayRail): string {
  switch (rail) {
    case 'memo':
      return 'Paid via Stellar payment'
    case 'contract':
      return 'Paid via smart contract'
    case 'x402':
      return 'Paid by an AI agent'
    default:
      return 'Paid'
  }
}

export function PaidReceipt({
  quote,
  payment,
}: {
  quote: PayQuote
  payment?: Payment
}) {
  const p = payment ?? quote.payment ?? quote.payments[quote.payments.length - 1]
  const explorer =
    p?.explorerUrl ??
    (p?.txHash ? `${import.meta.env.VITE_EXPLORER_TX_URL}${p.txHash}` : undefined)

  async function share() {
    const text = `Paid ${formatTRY(quote.amountTRY)} to ${quote.merchantName} via LiraLink${
      p?.txHash ? `\nTx: ${p.txHash}` : ''
    }${explorer ? `\n${explorer}` : ''}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'LiraLink receipt', text, url: explorer })
        return
      } catch {
        // fall through
      }
    }
    await navigator.clipboard.writeText(text)
  }

  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <CheckCircle2 className="size-14 text-success" />
      <div>
        <p className="text-xl font-semibold">Paid</p>
        <p className="text-sm text-muted-foreground">to {quote.merchantName}</p>
        {p?.rail ? (
          <p className="mt-1 text-xs font-medium text-slate-600">{railLabel(p.rail)}</p>
        ) : null}
      </div>
      <div className="w-full rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <p className="font-medium">{formatTRY(quote.amountTRY)}</p>
        <p className="text-muted-foreground" title={quote.receivedUSDC}>
          {formatUSDCDisplay(quote.receivedUSDC)} USDC received
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Rate {quote.fxRate} TRY/USDC
          {quote.fxSpread != null ? ` · spread ${quote.fxSpread}` : ''}
          <span className="block">Quoted {new Date(quote.fxRateAt).toLocaleString()}</span>
        </p>
      </div>
      {p ? (
        <div className="w-full space-y-2 text-left text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Tx</span>
            <span className="font-mono">{shortAddress(p.txHash, 6)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">From</span>
            <span className="font-mono">{shortAddress(p.payerAddress)}</span>
          </div>
          {quote.payments.length > 1 ? (
            <p className="text-muted-foreground">{quote.payments.length} transfers on this link</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex w-full flex-wrap justify-center gap-2">
        {p?.txHash ? <CopyButton value={p.txHash} label="Copy tx" /> : null}
        {explorer ? (
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={explorer} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              Stellar.Expert
            </a>
          </Button>
        ) : null}
        <Button type="button" variant="secondary" size="sm" onClick={share}>
          <Share2 className="size-3.5" />
          Share receipt
        </Button>
      </div>
    </div>
  )
}
