import { http, HttpResponse, type HttpHandler } from 'msw'

import {
  MOCK_CONTRACT_ID,
  MOCK_LEDGER_WINDOW,
  MOCK_TOKEN,
  computeBalance,
  debitUsdc,
  seed,
  simulatePayment,
  state,
  unallocatedSummary,
} from './data'
import { Decimal } from 'decimal.js'

import type { ApiError, LinkStatus, PaymentLink, PaymentWithLink, UsdcWithdrawal, Withdrawal } from '@/api/types'

seed()

function error(status: number, message: string) {
  const body: ApiError = { statusCode: status, message }
  return HttpResponse.json(body, { status })
}

function requireAuth(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${MOCK_TOKEN}`) return error(401, 'Unauthorized')
  return null
}

export const handlers: HttpHandler[] = [
  http.post('*/api/auth/register', async ({ request }) => {
    const body = (await request.json()) as { email: string; businessName: string }
    state.merchant = { ...state.merchant, email: body.email, businessName: body.businessName }
    return HttpResponse.json({ token: MOCK_TOKEN, merchant: state.merchant }, { status: 201 })
  }),

  http.post('*/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    if (body.email !== state.merchant.email || body.password !== state.password) {
      return error(401, 'Invalid email or password')
    }
    return HttpResponse.json({ token: MOCK_TOKEN, merchant: state.merchant })
  }),

  http.get('*/api/me', ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    return HttpResponse.json(state.merchant)
  }),

  http.patch('*/api/me', async ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const body = (await request.json()) as Partial<typeof state.merchant> & {
      currentPassword?: string
      newPassword?: string
    }
    if (body.currentPassword !== undefined || body.newPassword !== undefined) {
      if (!body.currentPassword || !body.newPassword) {
        return error(400, 'Both currentPassword and newPassword are required')
      }
      if (body.currentPassword !== state.password) {
        return error(403, 'Current password is incorrect')
      }
      state.password = body.newPassword
      return HttpResponse.json(state.merchant)
    }
    state.merchant = { ...state.merchant, ...body }
    return HttpResponse.json(state.merchant)
  }),

  http.get('*/api/links', ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const url = new URL(request.url)
    const status = url.searchParams.get('status') as LinkStatus | null
    const limit = Number(url.searchParams.get('limit') ?? '20')
    const items = state.links
      .filter((l) => !status || l.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
    return HttpResponse.json({ items, total: items.length })
  }),

  http.get('*/api/links/:id', ({ request, params }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const link = state.links.find((l) => l.id === params.id)
    if (!link) return error(404, 'Link not found')
    return HttpResponse.json(link)
  }),

  http.post('*/api/links', async ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const body = (await request.json()) as { title: string; description?: string; amountTRY: string; expiresInHours?: number }
    const code = `MOCK${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    const rate = 34
    const quotedUSDC = (Math.ceil((Number(body.amountTRY) / rate) * 1e7) / 1e7).toFixed(7)
    const hours = body.expiresInHours ?? 24
    const expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString()
    const newLink: PaymentLink = {
      id: `link-${code}`,
      code,
      merchantId: state.merchant.id,
      merchantName: state.merchant.businessName,
      title: body.title,
      description: body.description,
      amountTRY: Number(body.amountTRY).toFixed(2),
      quotedUSDC,
      fxRate: '34.0000000',
      fxRateAt: new Date().toISOString(),
      fxSpread: '0.0000000',
      quoteExpiresAt: expiresAt, // the quote is never re-quoted: quoteExpiresAt === expiresAt
      status: 'open',
      expiresAt,
      payUrl: `http://localhost:5174/p/${code}`,
      receivedUSDC: '0',
      payments: [],
      onchain: null,
      createdAt: new Date().toISOString(),
    }
    state.links.unshift(newLink)
    return HttpResponse.json(newLink, { status: 201 })
  }),

  http.post('*/api/links/:id/onchain', async ({ request, params }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const link = state.links.find((l) => l.id === params.id)
    if (!link) return error(404, 'Link not found')
    if (link.onchain) return HttpResponse.json(link)
    if (link.status !== 'open' || link.payments.length > 0) {
      return error(409, 'Only an open link with nothing received can get an on-chain invoice')
    }
    await new Promise((resolve) => setTimeout(resolve, 1000)) // Soroban submit takes a moment
    link.onchain = {
      contractId: MOCK_CONTRACT_ID,
      invoiceCode: link.code,
      deadlineLedger: 4_700_000 + MOCK_LEDGER_WINDOW,
    }
    return HttpResponse.json(link)
  }),

  http.post('*/api/links/:id/cancel', ({ request, params }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const link = state.links.find((l) => l.id === params.id)
    if (!link) return error(404, 'Link not found')
    if (link.status !== 'open') return error(409, 'Only open links can be cancelled')
    link.status = 'cancelled'
    return HttpResponse.json(link)
  }),

  // Mock-only dev toggle (03-MERCHANT-WEB.md): rehearse the Open -> Paid projector
  // transition without a real wallet. Not part of the real API contract.
  http.post('*/api/mock/pay/:id', ({ params }) => {
    simulatePayment(params.id as string)
    return HttpResponse.json({ accepted: true }, { status: 202 })
  }),

  http.get('*/api/balance', ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    return HttpResponse.json(computeBalance())
  }),

  http.get('*/api/payments', ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const url = new URL(request.url)
    const limit = Number(url.searchParams.get('limit') ?? '20')
    const items: PaymentWithLink[] = state.links
      .flatMap((link) =>
        link.payments.map((payment) => ({
          ...payment,
          link: {
            code: link.code,
            title: link.title,
            amountTRY: link.amountTRY,
            status: link.status,
            quotedUSDC: link.quotedUSDC,
            receivedUSDC: link.receivedUSDC,
          },
          settlement: state.settlements.find((s) => s.paymentId === payment.id) ?? null,
        })),
      )
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
      .slice(0, limit)
    return HttpResponse.json({ items, total: items.length })
  }),

  http.get('*/api/settlements', ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const url = new URL(request.url)
    const limit = Number(url.searchParams.get('limit') ?? '20')
    const items = [...state.settlements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
    return HttpResponse.json({ items, total: items.length })
  }),

  http.get('*/api/unallocated', ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const items = [...state.credits].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return HttpResponse.json({ items, total: items.length, summary: unallocatedSummary() })
  }),

  http.get('*/api/usdc-withdrawals', ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? '20')
    const items = [...state.usdcWithdrawals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
    return HttpResponse.json({ items, total: state.usdcWithdrawals.length })
  }),

  http.post('*/api/usdc-withdrawals', async ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const body = (await request.json()) as { amountUSDC?: string; destination?: string; source?: string }
    if (!body.amountUSDC || !/^\d+(\.\d{1,7})?$/.test(body.amountUSDC) || new Decimal(body.amountUSDC).lte(0)) {
      return error(400, 'amountUSDC must be a positive decimal string')
    }
    if (!body.destination || !/^G[A-Z2-7]{55}$/.test(body.destination)) {
      return error(400, 'destination must be a Stellar G… address')
    }
    if (body.source !== 'saved' && body.source !== 'unallocated') {
      return error(400, "source must be 'saved' or 'unallocated'")
    }
    // The amount is debited when the request is accepted, and returned to `source` on failure.
    if (!debitUsdc(body.source, new Decimal(body.amountUSDC))) return error(422, 'Insufficient balance')

    const txHash = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    const withdrawal: UsdcWithdrawal = {
      id: `uwd-${Date.now()}`,
      merchantId: state.merchant.id,
      amountUSDC: new Decimal(body.amountUSDC).toFixed(7),
      destination: body.destination,
      source: body.source,
      status: 'submitted',
      txHash,
      explorerUrl: `${import.meta.env.VITE_EXPLORER_TX_URL}${txHash}`,
      failReason: null,
      createdAt: new Date().toISOString(),
    }
    state.usdcWithdrawals.unshift(withdrawal)
    setTimeout(() => {
      withdrawal.status = 'completed'
      withdrawal.completedAt = new Date().toISOString()
    }, 5000)
    return HttpResponse.json(withdrawal, { status: 201 })
  }),

  http.get('*/api/withdrawals', ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    const url = new URL(request.url)
    const limit = Number(url.searchParams.get('limit') ?? '20')
    const items = [...state.withdrawals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
    return HttpResponse.json({ items, total: items.length })
  }),

  http.post('*/api/withdrawals', async ({ request }) => {
    const authError = requireAuth(request)
    if (authError) return authError
    if (state.merchant.settlementMode === 'auto_payout') {
      return error(409, 'Payouts are automatic in this mode')
    }
    const body = (await request.json()) as { amountTRY: string; iban?: string }
    const iban = body.iban ?? state.merchant.iban
    if (!iban) return error(400, 'No IBAN on file — set one in Settings or provide one here')
    const balance = computeBalance()
    if (Number(body.amountTRY) > Number(balance.availableTRY)) {
      return error(422, 'Amount exceeds available balance')
    }
    const withdrawal: Withdrawal = {
      id: `wd-${Date.now()}`,
      merchantId: state.merchant.id,
      amountTRY: Number(body.amountTRY).toFixed(2),
      iban,
      status: 'requested',
      createdAt: new Date().toISOString(),
    }
    state.withdrawals.unshift(withdrawal)
    setTimeout(() => {
      withdrawal.status = 'processing'
      setTimeout(() => {
        withdrawal.status = 'completed'
        withdrawal.completedAt = new Date().toISOString()
      }, 2500)
    }, 2500)
    return HttpResponse.json(withdrawal, { status: 201 })
  }),
]
