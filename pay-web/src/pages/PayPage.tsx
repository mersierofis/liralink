import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AmountDisplay } from '@/components/AmountDisplay'
import { ErrorState } from '@/components/ErrorState'
import { MerchantHeader } from '@/components/MerchantHeader'
import { PaidReceipt } from '@/components/PaidReceipt'
import { PayButton } from '@/components/PayButton'
import { PayingState } from '@/components/PayingState'
import { TestnetRequiredCard } from '@/components/TestnetRequiredCard'
import { PrivyEmailButton, type PrivySession } from '@/components/PrivyEmailButton'
import { WalletButton } from '@/components/WalletButton'
import { HttpError } from '@/api/client'
import { payAmountUSDC, usePayQuote, usePayStatus, useSubmitted } from '@/api/hooks'
import type { PayQuote } from '@/api/types'
import { isPrivyEnabled } from '@/privy/PrivyGate'
import { buildPaymentXdr, loadUsdcBalance, submitSignedXdr } from '@/stellar/buildPayment'
import { isContractRailEnabled, payViaContract } from '@/stellar/payViaContract'
import { payViaPrivy } from '@/stellar/payViaPrivy'
import { useWallet } from '@/stellar/useWallet'

type UiPhase = 'quote' | 'paying' | 'paid'

function StatusBadge({ status }: { status: PayQuote['status'] }) {
  const map: Record<PayQuote['status'], { label: string; className: string }> = {
    open: { label: 'Open', className: 'bg-secondary text-secondary-foreground' },
    underpaid: { label: 'Underpaid', className: 'bg-warning text-warning-foreground' },
    paid: { label: 'Paid', className: 'bg-success text-success-foreground' },
    expired: { label: 'Expired', className: 'bg-muted text-muted-foreground' },
    cancelled: { label: 'Cancelled', className: 'bg-destructive text-destructive-foreground' },
  }
  const s = map[status]
  return <Badge className={s.className}>{s.label}</Badge>
}

export function PayPage() {
  const { code: rawCode } = useParams()
  const code = rawCode?.toUpperCase()
  const [searchParams] = useSearchParams()
  const mockPay = searchParams.get('mockpay') === '1'
  const queryClient = useQueryClient()

  const quoteQuery = usePayQuote(code)
  const wallet = useWallet()
  const submitted = useSubmitted(code)
  const [privySession, setPrivySession] = useState<PrivySession | null>(null)

  const [phase, setPhase] = useState<UiPhase>('quote')
  const [payError, setPayError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loadingRail, setLoadingRail] = useState<'memo' | 'contract' | null>(null)
  const [lastRail, setLastRail] = useState<'memo' | 'contract'>('memo')
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null)
  /** Client-side: expiresAt elapsed — rate is never re-quoted; show expired screen. */
  const [linkExpiredLocally, setLinkExpiredLocally] = useState(false)
  const [balances, setBalances] = useState<{
    hasTrustline: boolean
    balance: string
    funded: boolean
  } | null>(null)

  const payerAddress = wallet.address ?? privySession?.address ?? null
  const usingPrivy = !wallet.address && Boolean(privySession?.address)

  const quote = quoteQuery.data
  const payable = quote?.status === 'open' || quote?.status === 'underpaid'
  const inFlight = phase === 'paying' || Boolean(pendingTxHash)
  const inFlightRef = useRef(inFlight)
  inFlightRef.current = inFlight
  const shouldPoll =
    phase === 'paying' || (payable && Boolean(pendingTxHash)) || quote?.status === 'underpaid'

  const statusQuery = usePayStatus(code, Boolean(code) && shouldPoll)

  const liveStatus = statusQuery.data?.status ?? quote?.status
  const mergedQuote: PayQuote | undefined = useMemo(() => {
    if (!quote) return undefined
    if (!statusQuery.data) return quote
    return {
      ...quote,
      status: statusQuery.data.status,
      receivedUSDC: statusQuery.data.receivedUSDC,
      shortfallUSDC: statusQuery.data.shortfallUSDC,
      payment: statusQuery.data.payment ?? quote.payment,
      payments: statusQuery.data.payments?.length ? statusQuery.data.payments : quote.payments,
    }
  }, [quote, statusQuery.data])

  useEffect(() => {
    if (liveStatus === 'paid') setPhase('paid')
  }, [liveStatus])

  useEffect(() => {
    setLinkExpiredLocally(false)
  }, [code])

  // Local expiry is only a hint for payable links. Never override a receipt or an in-flight pay.
  useEffect(() => {
    if (!quote?.expiresAt) return
    if (quote.status !== 'open' && quote.status !== 'underpaid') return
    if (phase === 'paying' || pendingTxHash) return
    if (Date.parse(quote.expiresAt) <= Date.now()) setLinkExpiredLocally(true)
  }, [quote?.expiresAt, quote?.status, phase, pendingTxHash])

  const handleLinkExpired = useCallback(() => {
    if (inFlightRef.current) return
    setLinkExpiredLocally(true)
  }, [])

  useEffect(() => {
    if (!payerAddress || !quote) {
      setBalances(null)
      return
    }
    let cancelled = false
    void loadUsdcBalance(payerAddress, quote.asset).then((b) => {
      if (!cancelled) setBalances(b)
    })
    return () => {
      cancelled = true
    }
  }, [payerAddress, quote])

  async function runPay(opts?: { skipWallet?: boolean; rail?: 'memo' | 'contract' }) {
    if (!mergedQuote || !code) return
    const rail = opts?.rail ?? 'memo'
    setPayError(null)
    setSubmitting(true)
    setLoadingRail(rail)
    setLastRail(rail)
    let alreadySubmitted = false
    try {
      if (opts?.skipWallet || mockPay) {
        const fakeHash = `mock${Date.now().toString(16).padStart(56, '0')}`.slice(0, 64)
        setPhase('paying')
        setPendingTxHash(fakeHash)
        void submitted.mutateAsync(fakeHash).catch(() => undefined)
        return
      }
      if (!payerAddress) {
        setPayError('Connect a wallet first.')
        return
      }

      let hash: string
      if (usingPrivy && rail === 'memo' && privySession) {
        const result = await payViaPrivy({
          quote: mergedQuote,
          address: payerAddress,
          signHash: privySession.signHash,
        })
        hash = result.hash
      } else if (rail === 'contract') {
        if (!wallet.address) {
          setPayError('Contract rail needs Freighter / Wallets Kit (not email wallet).')
          return
        }
        const result = await payViaContract({
          quote: mergedQuote,
          payer: wallet.address,
          signXdr: wallet.signXdr,
          onSubmitted: (txHash) => {
            alreadySubmitted = true
            setPendingTxHash(txHash)
            setPhase('paying')
            void submitted.mutateAsync(txHash).catch(() => undefined)
          },
        })
        hash = result.hash
      } else {
        if (!wallet.address) {
          setPayError('Connect Freighter, or finish email sign-in.')
          return
        }
        const xdr = await buildPaymentXdr(mergedQuote, wallet.address)
        const signed = await wallet.signXdr(xdr)
        const result = await submitSignedXdr(signed)
        hash = result.hash
      }

      if (!alreadySubmitted) {
        setPendingTxHash(hash)
        setPhase('paying')
        void submitted.mutateAsync(hash).catch(() => undefined)
      }
      void queryClient.invalidateQueries({ queryKey: ['pay', code] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment failed'
      // FAILED on-chain still fires onSubmitted; reset UI so we don't poll forever.
      if (alreadySubmitted && /failed on-chain/i.test(msg)) {
        setPhase('quote')
        setPendingTxHash(null)
        setPayError(msg)
      } else if (alreadySubmitted) {
        setPayError(msg)
      } else {
        setPhase('quote')
        setPayError(msg)
      }
    } finally {
      setSubmitting(false)
      setLoadingRail(null)
    }
  }

  if (!code) {
    return (
      <Shell>
        <ErrorState title="No link" message="Open a payment link like /p/DEMO0001." />
      </Shell>
    )
  }

  if (quoteQuery.isLoading) {
    return (
      <Shell>
        <Card className="w-full max-w-[420px]">
          <CardContent className="space-y-4 p-6">
            <Skeleton className="mx-auto h-4 w-24" />
            <Skeleton className="mx-auto h-6 w-48" />
            <Skeleton className="mx-auto h-10 w-40" />
            <Skeleton className="h-11 w-full" />
          </CardContent>
        </Card>
      </Shell>
    )
  }

  if (quoteQuery.isError) {
    const notFound = quoteQuery.error instanceof HttpError && quoteQuery.error.statusCode === 404
    return (
      <Shell>
        <ErrorState
          title={notFound ? 'Link not found' : 'Could not load link'}
          message={
            notFound
              ? `No payment link with code ${code}.`
              : quoteQuery.error instanceof Error
                ? quoteQuery.error.message
                : 'Unknown error'
          }
          onRetry={() => void quoteQuery.refetch()}
        />
      </Shell>
    )
  }

  if (!mergedQuote) return null

  // Receipt wins over local/server expiry — a paid link past expiresAt must still show the receipt.
  if (mergedQuote.status === 'paid' || phase === 'paid') {
    return (
      <Shell>
        <Card className="w-full max-w-[420px]">
          <CardHeader className="items-center">
            <StatusBadge status="paid" />
          </CardHeader>
          <CardContent>
            <PaidReceipt quote={mergedQuote} payment={statusQuery.data?.payment} />
          </CardContent>
        </Card>
      </Shell>
    )
  }

  const localExpiryVisible =
    linkExpiredLocally &&
    (mergedQuote.status === 'open' || mergedQuote.status === 'underpaid') &&
    !inFlight

  if (mergedQuote.status === 'expired' || mergedQuote.status === 'cancelled' || localExpiryVisible) {
    const expired = mergedQuote.status === 'expired' || localExpiryVisible
    return (
      <Shell>
        <Card className="w-full max-w-[420px]">
          <CardHeader className="items-center gap-2">
            <StatusBadge status={expired ? 'expired' : 'cancelled'} />
            <MerchantHeader
              merchantName={mergedQuote.merchantName}
              title={mergedQuote.title}
              description={mergedQuote.description}
            />
          </CardHeader>
          <CardContent>
            <ErrorState
              title={expired ? 'Link expired' : 'Link cancelled'}
              message={
                expired
                  ? 'This link has expired. Ask the merchant for a new payment link — the rate is not refreshed.'
                  : 'This payment link was cancelled by the merchant.'
              }
            />
          </CardContent>
        </Card>
      </Shell>
    )
  }

  return (
    <Shell>
      <Card className="w-full max-w-[420px]">
        <CardHeader className="items-center gap-3 space-y-0">
          <StatusBadge status={mergedQuote.status} />
          <MerchantHeader
            merchantName={mergedQuote.merchantName}
            title={mergedQuote.title}
            description={mergedQuote.description}
          />
        </CardHeader>
        <CardContent className="space-y-5">
          <AmountDisplay quote={mergedQuote} onLinkExpired={handleLinkExpired} />

          {phase === 'paying' ? (
            <PayingState />
          ) : (
            <>
              <WalletButton
                address={wallet.address}
                connecting={wallet.connecting}
                usdcBalance={balances?.balance}
                hasTrustline={balances?.hasTrustline}
                funded={balances?.funded}
                onConnect={() => void wallet.connect()}
                onDisconnect={wallet.disconnect}
              />
              {isPrivyEnabled() && !wallet.address ? (
                <PrivyEmailButton onSession={setPrivySession} />
              ) : null}
              {wallet.errorKind === 'mainnet' ? (
                <TestnetRequiredCard
                  onRetry={() => {
                    wallet.clearError()
                    void wallet.connect()
                  }}
                />
              ) : wallet.error ? (
                <ErrorState title="Wallet" message={wallet.error} onRetry={() => void wallet.connect()} />
              ) : null}
              {payError ? (
                <ErrorState
                  title="Payment failed"
                  message={payError}
                  onRetry={() => void runPay({ rail: lastRail })}
                />
              ) : null}
              <PayButton
                amountUSDC={payAmountUSDC(mergedQuote)}
                disabled={
                  mockPay
                    ? false
                    : !payerAddress ||
                      !balances?.funded ||
                      !balances.hasTrustline ||
                      submitting
                }
                loading={submitting}
                loadingRail={loadingRail}
                hasContractRail={
                  !usingPrivy &&
                  isContractRailEnabled() &&
                  Boolean(mergedQuote.rails.contract) &&
                  mergedQuote.status === 'open'
                }
                onPayMemo={() => void runPay({ skipWallet: mockPay, rail: 'memo' })}
                onPayContract={() => void runPay({ rail: 'contract' })}
              />
              {mockPay ? (
                <p className="text-center text-[11px] text-muted-foreground">
                  Dev mode: ?mockpay=1 skips the wallet and hits /submitted with a fake hash.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-8">
      <div className="mx-auto mb-6 max-w-[420px] text-center">
        <p className="text-sm font-semibold tracking-tight text-slate-900">LiraLink</p>
        <p className="text-xs text-muted-foreground">Pay with USDC on Stellar</p>
      </div>
      <div className="mx-auto flex max-w-[420px] justify-center">{children}</div>
    </div>
  )
}
