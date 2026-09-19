import { http, HttpResponse } from 'msw'
import type { GetPayStatusResponse } from '@/api/types'
import { mockPollCounts, mockStore } from './data'

function toStatus(code: string): GetPayStatusResponse {
  const q = mockStore[code]
  return {
    status: q.status,
    receivedUSDC: q.receivedUSDC,
    shortfallUSDC: q.shortfallUSDC,
    payment: q.payment,
    payments: q.payments,
  }
}

export const handlers = [
  http.get('*/api/pay/:code', ({ params }) => {
    const code = String(params.code).toUpperCase()
    const quote = mockStore[code]
    if (!quote) {
      return HttpResponse.json(
        { statusCode: 404, message: `Unknown payment link ${code}`, error: 'Not Found' },
        { status: 404 },
      )
    }
    return HttpResponse.json(quote)
  }),

  http.post('*/api/pay/:code/submitted', async ({ params, request }) => {
    const code = String(params.code).toUpperCase()
    const body = (await request.json()) as { txHash?: string }
    const quote = mockStore[code]
    if (!quote) {
      return HttpResponse.json(
        { statusCode: 404, message: `Unknown payment link ${code}`, error: 'Not Found' },
        { status: 404 },
      )
    }
    if (body.txHash) {
      mockPollCounts[code] = 0
      ;(quote as { _pendingTx?: string })._pendingTx = body.txHash
    }
    return HttpResponse.json({ accepted: true }, { status: 202 })
  }),

  http.get('*/api/pay/:code/status', ({ params }) => {
    const code = String(params.code).toUpperCase()
    const quote = mockStore[code]
    if (!quote) {
      return HttpResponse.json(
        { statusCode: 404, message: `Unknown payment link ${code}`, error: 'Not Found' },
        { status: 404 },
      )
    }

    const pendingTx = (quote as { _pendingTx?: string })._pendingTx
    if (pendingTx && (quote.status === 'open' || quote.status === 'underpaid')) {
      mockPollCounts[code] = (mockPollCounts[code] ?? 0) + 1
      if (mockPollCounts[code] >= 3) {
        const amount =
          quote.status === 'underpaid' && quote.shortfallUSDC
            ? quote.shortfallUSDC
            : quote.amountUSDC
        const p = {
          id: crypto.randomUUID(),
          linkId: `mock-${code}`,
          rail: 'memo' as const,
          txHash: pendingTx,
          payerAddress: 'GBRZSG7K6ZXJRCMYM2O2HO2DKR7RO2ACZ5FARBMQZBB4YZMDFDXFUTV7',
          amountUSDC: amount,
          ledger: 4649999,
          explorerUrl: `https://stellar.expert/explorer/testnet/tx/${pendingTx}`,
          detectedAt: new Date().toISOString(),
        }
        quote.payments = [...quote.payments, p]
        quote.payment = p
        quote.receivedUSDC = quote.amountUSDC
        quote.status = 'paid'
        delete quote.shortfallUSDC
        delete (quote as { _pendingTx?: string })._pendingTx
      }
    }

    return HttpResponse.json(toStatus(code))
  }),
]
