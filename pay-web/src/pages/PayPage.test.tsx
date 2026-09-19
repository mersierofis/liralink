import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PayQuote, Payment } from '@/api/types'
import { PayPage } from './PayPage'

vi.mock('@/stellar/useWallet', () => ({
  useWallet: () => ({
    address: null,
    walletId: null,
    connecting: false,
    error: null,
    errorKind: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signXdr: vi.fn(),
    clearError: vi.fn(),
  }),
}))

vi.mock('@/privy/PrivyGate', () => ({
  isPrivyEnabled: () => false,
}))

vi.mock('@/stellar/walletKit', () => ({
  getWalletKit: () => ({}),
  WalletNetwork: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
}))

vi.mock('@stellar/freighter-api', () => ({}))
vi.mock('@creit.tech/stellar-wallets-kit', () => ({
  StellarWalletsKit: class {},
  allowAllModules: () => [],
  FREIGHTER_ID: 'freighter',
}))

const PLATFORM = 'GDWV6USF4R2ULWR5XW3TEUZSIRGRCU7PQWGSBDYJVIRFNAJ3LVNQ34N2'
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
const PAYER = 'GBRZSG7K6ZXJRCMYM2O2HO2DKR7RO2ACZ5FARBMQZBB4YZMDFDXFUTV7'

function makePayment(amountUSDC: string): Payment {
  const txHash = '7b80b57dfba0d61ca744496457e98e34299397da35d39d7cd32f8caacaa6af94'
  return {
    id: 'pay-1',
    linkId: 'link-1',
    rail: 'memo',
    txHash,
    amountUSDC,
    payerAddress: PAYER,
    ledger: 4642155,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txHash}`,
    detectedAt: new Date().toISOString(),
  }
}

function makeQuote(overrides: Partial<PayQuote> & Pick<PayQuote, 'code' | 'status'>): PayQuote {
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 60_000).toISOString()
  return {
    merchantName: 'Demo Merchant',
    title: 'Test order',
    amountTRY: '100.00',
    amountUSDC: '3.0000000',
    fxRate: '34.0000000',
    fxRateAt: new Date(Date.now() - 60_000).toISOString(),
    fxSpread: '0.0050000',
    quoteExpiresAt: expiresAt,
    expiresAt,
    receivedUSDC: '0.0000000',
    rails: { memo: { destination: PLATFORM, memo: overrides.code } },
    asset: { code: 'USDC', issuer: USDC_ISSUER },
    network: 'testnet',
    payments: [],
    ...overrides,
  }
}

function renderPay(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:code" element={<PayPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PayPage expiry vs receipt', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows the receipt for a paid link even when expiresAt is in the past', async () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const payment = makePayment('3.0000000')
    const quote = makeQuote({
      code: 'PAIDOLD1',
      status: 'paid',
      expiresAt: past,
      quoteExpiresAt: past,
      receivedUSDC: '3.0000000',
      payment,
      payments: [payment],
    })

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/pay/PAIDOLD1') && !url.includes('/status') && !url.includes('/submitted')) {
        return new Response(JSON.stringify(quote), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    renderPay('/p/PAIDOLD1')

    expect(await screen.findByRole('button', { name: /share receipt/i })).toBeInTheDocument()
    expect(screen.getByText(/to Demo Merchant/i)).toBeInTheDocument()
    expect(screen.queryByText('Link expired')).not.toBeInTheDocument()
  })

  it('does not swap to Link expired while a payment is in flight when the countdown hits zero', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const expiresAt = new Date(Date.now() + 2_500).toISOString()
    const openQuote = makeQuote({
      code: 'PAYING01',
      status: 'open',
      expiresAt,
      quoteExpiresAt: expiresAt,
    })

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/pay/PAYING01/submitted') && init?.method === 'POST') {
        return new Response(JSON.stringify({ accepted: true }), { status: 202 })
      }
      if (url.includes('/pay/PAYING01/status')) {
        return new Response(
          JSON.stringify({
            status: 'open',
            receivedUSDC: '0.0000000',
            payments: [],
          }),
          { status: 200 },
        )
      }
      if (url.includes('/pay/PAYING01')) {
        return new Response(JSON.stringify(openQuote), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    renderPay('/p/PAYING01?mockpay=1')

    expect(await screen.findByText(/Rate locked/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Pay .* USDC/i }))

    expect(await screen.findByText(/Confirming on Stellar/i)).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(5_000)

    expect(screen.getByText(/Confirming on Stellar/i)).toBeInTheDocument()
    expect(screen.queryByText('Link expired')).not.toBeInTheDocument()
  })
})
