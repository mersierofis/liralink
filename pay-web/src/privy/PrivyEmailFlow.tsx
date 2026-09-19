import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PrivySession } from '@/components/PrivyEmailButton'
import { shortAddress } from '@/stellar/format'
import { PrivyGate } from '@/privy/PrivyGate'
import { usePrivyPay } from '@/privy/usePrivyPay'
import { type SetupStep, coversAmount, privyUsdcBalance, setupPrivyWallet } from '@/stellar/setupPrivyWallet'

type FlowProps = {
  onSession?: (session: PrivySession) => void
  asset: { code: string; issuer: string }
  amountUSDC: string
}

type Setup =
  | { kind: 'running'; step: SetupStep }
  | { kind: 'done'; usdcBalance: string }
  | { kind: 'failed'; message: string }

const STEP_LABEL: Record<SetupStep, string> = {
  checking: 'Setting up your wallet…',
  funding: 'Setting up your wallet: activating it on Stellar testnet…',
  trustline: 'Setting up your wallet: enabling USDC…',
}

/** While the wallet cannot cover the amount, re-read its balance this often (faucet top-up). */
const BALANCE_POLL_MS = 5_000

/**
 * The Privy email path, loaded with React.lazy from `PrivyEmailButton` only once the payer picks
 * email sign-in. Everything Privy (SDK, WalletConnect tree) stays out of the main bundle.
 */
export default function PrivyEmailFlow(props: FlowProps) {
  return (
    <PrivyGate>
      <PrivyEmailFlowInner {...props} />
    </PrivyGate>
  )
}

function PrivyEmailFlowInner({ onSession, asset, amountUSDC }: FlowProps) {
  const privy = usePrivyPay()
  const { startEmail } = privy

  // Privy's hooks can return new functions on any render. Handing those to the parent re-rendered
  // it, which re-rendered this flow, which produced new functions again: an infinite loop (React
  // #185). The parent gets one stable signHash that always calls the latest one, and hears about
  // the session only when the address changes.
  const signHashRef = useRef(privy.signHash)
  signHashRef.current = privy.signHash
  const signHash = useCallback((hashHex: string) => signHashRef.current(hashHex), [])

  // A new Privy wallet is only a key: fund it and add the USDC trustline before it can pay.
  const [setup, setSetup] = useState<Setup | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { address } = privy
  const issuer = asset.issuer
  const assetCode = asset.code
  useEffect(() => {
    if (!address) {
      setSetup(null)
      return
    }
    let cancelled = false
    setSetup({ kind: 'running', step: 'checking' })
    setupPrivyWallet({
      address,
      asset: { code: assetCode, issuer },
      signHash,
      horizonUrl: import.meta.env.VITE_HORIZON_URL,
      onStep: (step) => !cancelled && setSetup({ kind: 'running', step }),
    }).then(
      ({ usdcBalance }) => !cancelled && setSetup({ kind: 'done', usdcBalance }),
      (e: unknown) => !cancelled && setSetup({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      cancelled = true
    }
  }, [address, assetCode, issuer, signHash, attempt])

  const usdcBalance = setup?.kind === 'done' ? setup.usdcBalance : null
  const covered = usdcBalance !== null && coversAmount(usdcBalance, amountUSDC)

  // Waiting for testnet USDC from the faucet: pick the top-up up without a reload.
  useEffect(() => {
    if (!address || usdcBalance === null || covered) return
    const timer = setInterval(() => {
      void privyUsdcBalance(address, { code: assetCode, issuer }, import.meta.env.VITE_HORIZON_URL)
        .then((b) => setSetup((s) => (s?.kind === 'done' && s.usdcBalance !== b ? { kind: 'done', usdcBalance: b } : s)))
        .catch(() => undefined)
    }, BALANCE_POLL_MS)
    return () => clearInterval(timer)
  }, [address, usdcBalance, covered, assetCode, issuer])

  // The pay page sees the wallet only once it is set up, so it never offers a Pay that cannot work.
  const sessionAddress = usdcBalance !== null ? address : null
  useEffect(() => {
    onSession?.({ address: sessionAddress, signHash, usdcBalance })
  }, [sessionAddress, signHash, usdcBalance, onSession])

  // Mounting this chunk *is* the payer picking email sign-in: go straight to the email step.
  useEffect(() => {
    startEmail()
  }, [startEmail])

  if (!privy.ready) {
    return (
      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Loading email sign-in…
      </p>
    )
  }

  if (privy.phase === 'ready' && privy.address) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Mail className="size-4" />
            <span className="font-mono text-xs">{shortAddress(privy.address)}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              email wallet
            </span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void privy.disconnect()}>
            Sign out
          </Button>
        </div>
        {setup === null || setup.kind === 'running' ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3 animate-spin" />
            {STEP_LABEL[setup?.step ?? 'checking']}
          </p>
        ) : setup.kind === 'failed' ? (
          <div className="space-y-1">
            <p className="text-xs text-destructive">Could not set up your wallet: {setup.message}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : covered ? (
          <p className="text-xs text-muted-foreground">Wallet ready · {setup.usdcBalance} USDC</p>
        ) : (
          <FundInstruction address={privy.address} balance={setup.usdcBalance} amountUSDC={amountUSDC} />
        )}
      </div>
    )
  }

  if (privy.phase === 'email') {
    return (
      <div className="space-y-2 rounded-lg border border-dashed p-3">
        <label className="text-xs font-medium" htmlFor="privy-email">
          Email
        </label>
        <input
          id="privy-email"
          type="email"
          autoComplete="email"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={privy.email}
          onChange={(e) => privy.setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <Button
          type="button"
          className="w-full"
          variant="secondary"
          disabled={privy.busy}
          onClick={() => void privy.submitEmail()}
        >
          {privy.busy ? <Loader2 className="animate-spin" /> : null}
          Send code
        </Button>
        {privy.error ? <p className="text-xs text-destructive">{privy.error}</p> : null}
      </div>
    )
  }

  if (privy.phase === 'code') {
    return (
      <div className="space-y-2 rounded-lg border border-dashed p-3">
        <label className="text-xs font-medium" htmlFor="privy-code">
          Code from email
        </label>
        <input
          id="privy-code"
          inputMode="numeric"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={privy.code}
          onChange={(e) => privy.setCode(e.target.value)}
          placeholder="123456"
        />
        <Button
          type="button"
          className="w-full"
          variant="secondary"
          disabled={privy.busy}
          onClick={() => void privy.submitCode()}
        >
          {privy.busy ? <Loader2 className="animate-spin" /> : null}
          Verify & create Stellar wallet
        </Button>
        {privy.error ? <p className="text-xs text-destructive">{privy.error}</p> : null}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="link"
        className="h-auto w-full px-0 text-sm text-muted-foreground"
        onClick={privy.startEmail}
      >
        No wallet? Sign in with email
      </Button>
      {privy.error ? <p className="text-center text-xs text-destructive">{privy.error}</p> : null}
    </div>
  )
}

/** The wallet is set up but empty: how to get testnet USDC into it. Pay unlocks by itself after. */
function FundInstruction({ address, balance, amountUSDC }: { address: string; balance: string; amountUSDC: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2 text-xs">
      <p>
        Your wallet is ready but holds {balance} USDC; this payment needs {amountUSDC} USDC. Get testnet
        USDC from{' '}
        <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
          faucet.circle.com
        </a>{' '}
        (network: Stellar) and send it to this address:
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-[11px]">{address}</code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Copy address"
          onClick={() => {
            void navigator.clipboard?.writeText(address).then(() => setCopied(true))
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Waiting for USDC… Pay unlocks as soon as it arrives.
      </p>
    </div>
  )
}
