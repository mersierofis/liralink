import { useMutation, useQuery } from '@tanstack/react-query'
import { apiRequest } from './client'
import type { PayQuote, GetPayStatusResponse } from './types'

export function usePayQuote(code: string | undefined) {
  return useQuery({
    queryKey: ['pay', code],
    queryFn: () => apiRequest<PayQuote>(`/pay/${code}`),
    enabled: Boolean(code),
    retry: (failureCount, error) => {
      if (error instanceof Error && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404) {
        return false
      }
      return failureCount < 2
    },
  })
}

export function usePayStatus(code: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['pay-status', code],
    queryFn: () => apiRequest<GetPayStatusResponse>(`/pay/${code}/status`),
    enabled: Boolean(code) && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'paid' || status === 'expired' || status === 'cancelled') return false
      return 2000
    },
  })
}

export function useSubmitted(code: string | undefined) {
  return useMutation({
    mutationFn: (txHash: string) =>
      apiRequest<{ accepted: true }>(`/pay/${code}/submitted`, {
        method: 'POST',
        body: { txHash },
      }),
  })
}

/** Amount the payer should send right now (full quote, or remaining shortfall). */
export function payAmountUSDC(quote: Pick<PayQuote, 'status' | 'amountUSDC' | 'shortfallUSDC'>): string {
  if (quote.status === 'underpaid' && quote.shortfallUSDC) return quote.shortfallUSDC
  return quote.amountUSDC
}
