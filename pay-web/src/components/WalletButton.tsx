import { Loader2, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { shortAddress, formatUSDCDisplay } from '@/stellar/format'

export function WalletButton({
  address,
  connecting,
  usdcBalance,
  hasTrustline,
  funded,
  onConnect,
  onDisconnect,
}: {
  address: string | null
  connecting: boolean
  usdcBalance?: string
  hasTrustline?: boolean
  funded?: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  if (!address) {
    return (
      <Button type="button" className="w-full" size="lg" onClick={onConnect} disabled={connecting}>
        {connecting ? <Loader2 className="animate-spin" /> : <Wallet />}
        {connecting ? 'Connecting…' : 'Connect wallet'}
      </Button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Wallet className="size-4" />
          <span className="font-mono">{shortAddress(address)}</span>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
      {!funded ? (
        <p className="text-xs text-destructive">
          Account not funded on testnet. Use Friendbot at{' '}
          <a className="underline" href="https://lab.stellar.org" target="_blank" rel="noreferrer">
            lab.stellar.org
          </a>
          .
        </p>
      ) : !hasTrustline ? (
        <p className="text-xs text-warning">
          No USDC trustline / balance.{' '}
          <a
            className="underline"
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
          >
            Get testnet USDC
          </a>
          .
        </p>
      ) : (
        <p className="text-xs text-muted-foreground" title={usdcBalance}>
          USDC balance: {formatUSDCDisplay(usdcBalance ?? '0')}
        </p>
      )}
    </div>
  )
}
