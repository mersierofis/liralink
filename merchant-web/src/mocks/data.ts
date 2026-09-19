import type {
  Balance,
  Merchant,
  PaymentLink,
  Payment,
  Settlement,
  Withdrawal,
} from '@/api/types'

export const MOCK_TOKEN = 'mock-jwt-token'
// Mock-only credential — bears no relation to the real demo account's password, which was
// rotated out of the repo (backend/.env SEED_DEMO_PASSWORD, ask Hasan).
export const MOCK_PASSWORD = 'mock-password'
const FX_RATE = '34.0000000'
const PAY_WEB_BASE = 'http://localhost:5174/p'

function hex(len: number) {
  const chars = '0123456789abcdef'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function stellarAddress() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  return 'G' + Array.from({ length: 55 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function quoteUSDC(amountTRY: string, rate = FX_RATE): string {
  // Round up to 7dp so the payer never underpays, mirroring the real backend (01-BACKEND.md §1.4).
  const cents = Math.ceil((Number(amountTRY) / Number(rate)) * 1e7)
  return (cents / 1e7).toFixed(7)
}

function isoDaysAgo(days: number, hours = 0) {
  return new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString()
}

export const state = {
  merchant: {
    id: 'mock-merchant-1',
    email: 'demo@liralink.app',
    businessName: 'Erdemli Narenciye A.Ş.',
    iban: 'TR330006100519786457841326',
    autoSavePercent: 0,
    unallocatedUSDC: '0.0000000',
    settlementMode: 'balance',
    createdAt: isoDaysAgo(30),
  } as Merchant,

  password: MOCK_PASSWORD, // mutable — PATCH /me { currentPassword, newPassword } can change it
  links: [] as PaymentLink[],
  settlements: [] as Settlement[],
  withdrawals: [] as Withdrawal[],
}

function makePaidLink(opts: {
  code: string
  title: string
  amountTRY: string
  daysAgo: number
}): PaymentLink {
  const quotedUSDC = quoteUSDC(opts.amountTRY)
  const detectedAt = isoDaysAgo(opts.daysAgo)
  const txHash = hex(64)
  const payment: Payment = {
    id: `pay-${opts.code}`,
    linkId: `link-${opts.code}`,
    rail: 'memo',
    txHash,
    payerAddress: stellarAddress(),
    amountUSDC: quotedUSDC,
    ledger: 4_600_000 + Math.floor(Math.random() * 50_000),
    explorerUrl: `${import.meta.env.VITE_EXPLORER_TX_URL}${txHash}`,
    detectedAt,
  }
  const settlement: Settlement = {
    id: `settle-${opts.code}`,
    merchantId: state.merchant.id,
    paymentId: payment.id,
    amountUSDC: quotedUSDC,
    amountTRY: opts.amountTRY,
    fxRate: FX_RATE,
    savedUSDC: '0.0000000',
    feeUSDC: '0.0000000',
    netTRY: opts.amountTRY,
    provider: 'mock',
    status: 'completed',
    failReason: null,
    interactiveUrl: null,
    anchorRef: `mock-settle-${opts.code}`,
    createdAt: detectedAt,
    completedAt: detectedAt,
  }
  state.settlements.push(settlement)
  return {
    id: `link-${opts.code}`,
    code: opts.code,
    merchantId: state.merchant.id,
    merchantName: state.merchant.businessName,
    title: opts.title,
    amountTRY: opts.amountTRY,
    quotedUSDC,
    fxRate: FX_RATE,
    fxRateAt: isoDaysAgo(opts.daysAgo, 1), // fetched when the link was created
    fxSpread: '0.0000000', // the mock rate source has no spread
    quoteExpiresAt: isoDaysAgo(opts.daysAgo - 1),
    status: 'paid',
    expiresAt: isoDaysAgo(opts.daysAgo - 1),
    payUrl: `${PAY_WEB_BASE}/${opts.code}`,
    receivedUSDC: quotedUSDC,
    payment,
    payments: [payment],
    onchain: null,
    createdAt: isoDaysAgo(opts.daysAgo, 1),
  }
}

function makeOpenLink(opts: { code: string; title: string; amountTRY: string; daysAgo: number }): PaymentLink {
  const quotedUSDC = quoteUSDC(opts.amountTRY)
  const expiresAt = new Date(Date.now() + 24 * 3_600_000).toISOString()
  return {
    id: `link-${opts.code}`,
    code: opts.code,
    merchantId: state.merchant.id,
    merchantName: state.merchant.businessName,
    title: opts.title,
    amountTRY: opts.amountTRY,
    quotedUSDC,
    fxRate: FX_RATE,
    fxRateAt: isoDaysAgo(opts.daysAgo),
    fxSpread: '0.0000000',
    quoteExpiresAt: expiresAt, // never re-quoted: quoteExpiresAt === expiresAt
    status: 'open',
    expiresAt,
    payUrl: `${PAY_WEB_BASE}/${opts.code}`,
    receivedUSDC: '0',
    payments: [],
    onchain: null,
    createdAt: isoDaysAgo(opts.daysAgo),
  }
}

export function seed() {
  state.links = [
    makeOpenLink({ code: 'DEMO0001', title: 'Lemon order #1042 — Al Rashid Trading (Dubai)', amountTRY: '5000.00', daysAgo: 0 }),
    makeOpenLink({ code: 'DEMO0002', title: 'Orange shipment #77 — Berlin Fruchthandel', amountTRY: '3200.00', daysAgo: 1 }),
    makePaidLink({ code: 'DEMO0003', title: 'Dried apricots 10kg — Gulf Traders LLC', amountTRY: '680.00', daysAgo: 2 }),
    makePaidLink({ code: 'DEMO0004', title: 'Pomegranate crate — Moscow Fresh Import', amountTRY: '1200.00', daysAgo: 3 }),
    makePaidLink({ code: 'DEMO0005', title: 'Fig basket #12 — Amsterdam Organics', amountTRY: '450.00', daysAgo: 5 }),
    {
      ...makeOpenLink({ code: 'DEMO0006', title: 'Tangerine trial order — Riyadh Souq', amountTRY: '900.00', daysAgo: 10 }),
      status: 'expired',
      expiresAt: isoDaysAgo(9),
      quoteExpiresAt: isoDaysAgo(9),
    },
  ]
  state.settlements.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  state.withdrawals = []
}

export function computeBalance(): Balance {
  const completed = state.settlements.filter((s) => s.status === 'completed')
  const pending = state.settlements.filter((s) => s.status === 'pending' || s.status === 'processing')
  const nonFailedWithdrawals = state.withdrawals.filter((w) => w.status !== 'failed')

  // Mirrors the real backend: balances are built from netTRY (post-fee), not amountTRY.
  const availableTRY =
    completed.reduce((sum, s) => sum + Number(s.netTRY ?? s.amountTRY), 0) -
    nonFailedWithdrawals.reduce((sum, w) => sum + Number(w.amountTRY), 0)
  const pendingTRY = pending.reduce((sum, s) => sum + Number(s.amountTRY), 0)

  return {
    availableTRY: availableTRY.toFixed(2),
    pendingTRY: pendingTRY.toFixed(2),
    savedUSDC: '0.0000000',
    unallocatedUSDC: state.merchant.unallocatedUSDC,
    paidOutTRY: '0.00', // mock adapter is always settlementMode 'balance', never auto_payout
  }
}

/** Mock-only demo helper (POST /mock/pay/:id): flips an open link to paid ~2s later, then
 * settles it pending -> completed ~6s after that, mirroring the real listener + settlement
 * timing closely enough to rehearse the Open -> Paid projector transition without a wallet. */
export function simulatePayment(linkId: string) {
  const link = state.links.find((l) => l.id === linkId)
  if (!link || link.status !== 'open') return

  setTimeout(() => {
    const current = state.links.find((l) => l.id === linkId)
    if (!current || current.status !== 'open') return

    const txHash = hex(64)
    const payment: Payment = {
      id: `pay-${linkId}-${Date.now()}`,
      linkId,
      rail: 'memo',
      txHash,
      payerAddress: stellarAddress(),
      amountUSDC: current.quotedUSDC,
      ledger: 4_600_000 + Math.floor(Math.random() * 50_000),
      explorerUrl: `${import.meta.env.VITE_EXPLORER_TX_URL}${txHash}`,
      detectedAt: new Date().toISOString(),
    }
    current.status = 'paid'
    current.receivedUSDC = current.quotedUSDC
    current.payment = payment
    current.payments = [...current.payments, payment]

    const settlement: Settlement = {
      id: `settle-${payment.id}`,
      merchantId: state.merchant.id,
      paymentId: payment.id,
      amountUSDC: payment.amountUSDC,
      amountTRY: current.amountTRY,
      fxRate: FX_RATE,
      savedUSDC: '0.0000000',
      feeUSDC: null,
      netTRY: null,
      provider: 'mock',
      status: 'pending',
      failReason: null,
      interactiveUrl: null,
      createdAt: new Date().toISOString(),
    }
    state.settlements.unshift(settlement)

    setTimeout(() => {
      settlement.status = 'processing'
      setTimeout(() => {
        settlement.status = 'completed'
        settlement.anchorRef = `mock-settle-${settlement.id}`
        settlement.feeUSDC = '0.0000000'
        settlement.netTRY = settlement.amountTRY
        settlement.completedAt = new Date().toISOString()
      }, 3000)
    }, 3000)
  }, 2000)
}
