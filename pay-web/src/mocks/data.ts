import type { PayQuote, Payment } from '@/api/types'

const PLATFORM = 'GDWV6USF4R2ULWR5XW3TEUZSIRGRCU7PQWGSBDYJVIRFNAJ3LVNQ34N2'
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
const PAYER = 'GBRZSG7K6ZXJRCMYM2O2HO2DKR7RO2ACZ5FARBMQZBB4YZMDFDXFUTV7'

function payment(partial: Partial<Payment> & Pick<Payment, 'txHash' | 'amountUSDC' | 'linkId'>): Payment {
  return {
    id: partial.id ?? crypto.randomUUID(),
    rail: 'memo',
    payerAddress: PAYER,
    ledger: partial.ledger ?? 4642155,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${partial.txHash}`,
    detectedAt: partial.detectedAt ?? new Date().toISOString(),
    ...partial,
  }
}

function baseQuote(overrides: Partial<PayQuote> & Pick<PayQuote, 'code' | 'status'>): PayQuote {
  const code = overrides.code
  // Locked quote for the life of the link (backend FX): quoteExpiresAt === expiresAt.
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  return {
    merchantName: 'Erdemli Narenciye A.Ş.',
    title: 'Lemon order #1042',
    amountTRY: '5000.00',
    amountUSDC: '147.0588236',
    fxRate: '34.0000000',
    fxRateAt: new Date(Date.now() - 60_000).toISOString(),
    fxSpread: '0.0050237',
    quoteExpiresAt: expiresAt,
    expiresAt,
    receivedUSDC: '0.0000000',
    rails: { memo: { destination: PLATFORM, memo: code } },
    asset: { code: 'USDC', issuer: USDC_ISSUER },
    network: 'testnet',
    payments: [],
    ...overrides,
    code,
  }
}

/** Mutable mock store — handlers flip status after /submitted. */
export const mockStore: Record<string, PayQuote> = {
  DEMO0001: baseQuote({
    code: 'DEMO0001',
    status: 'open',
    title: 'Lemon order #1042',
    amountTRY: '5000.00',
    amountUSDC: '147.0588236',
  }),
  DEMO0002: (() => {
    const tx = '7b80b57dfba0d61ca744496457e98e34299397da35d39d7cd32f8caacaa6af94'
    const p = payment({
      linkId: 'demo-2',
      txHash: tx,
      amountUSDC: '10.0000000',
    })
    return baseQuote({
      code: 'DEMO0002',
      status: 'paid',
      title: 'Kuru kayisi 5kg',
      amountTRY: '340.00',
      amountUSDC: '10.0000000',
      receivedUSDC: '10.0000000',
      payment: p,
      payments: [p],
    })
  })(),
  DEMO0003: baseQuote({
    code: 'DEMO0003',
    status: 'expired',
    quoteExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  }),
  DEMO0004: baseQuote({
    code: 'DEMO0004',
    status: 'cancelled',
  }),
}

/** After /submitted, DEMO0001 flips to paid on the 3rd status poll. */
export const mockPollCounts: Record<string, number> = {}
