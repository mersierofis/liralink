import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'

import { HttpError, apiRequest } from './client'
import type {
  PostAuthLoginResponse,
  Balance,
  LinkStatus,
  Merchant,
  Paginated,
  PaymentLink,
  PaymentWithLink,
  GetUnallocatedResponse,
  GetUsdcWithdrawalsResponse,
  PostUsdcWithdrawalsRequest,
  UsdcWithdrawal,
  Withdrawal,
} from './types'

export function useMe(enabled: boolean) {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiRequest<Merchant>('/me'),
    enabled,
  })
}

export function useLogin() {
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      apiRequest<PostAuthLoginResponse>('/auth/login', { method: 'POST', body, auth: false }),
  })
}

export function useRegister() {
  return useMutation({
    mutationFn: (body: { email: string; password: string; businessName: string }) =>
      apiRequest<PostAuthLoginResponse>('/auth/register', { method: 'POST', body, auth: false }),
  })
}

export function useUpdateMe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { businessName?: string; iban?: string; autoSavePercent?: number }) =>
      apiRequest<Merchant>('/me', { method: 'PATCH', body }),
    onSuccess: (merchant) => {
      queryClient.setQueryData(['me'], merchant)
    },
  })
}

/** Separate from useUpdateMe: a 403 here (wrong currentPassword) is an inline form error,
 * never a logout — see 04-BACKEND-HANDOFF.md gotcha #7. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      apiRequest<Merchant>('/me', { method: 'PATCH', body }),
  })
}

export interface LinksFilter {
  status?: LinkStatus | 'all'
  page?: number
  limit?: number
}

export function useLinks(filters: LinksFilter = {}) {
  const params = new URLSearchParams()
  if (filters.status && filters.status !== 'all') params.set('status', filters.status)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.limit) params.set('limit', String(filters.limit))
  const qs = params.toString()

  return useQuery({
    queryKey: ['links', filters],
    queryFn: () => apiRequest<Paginated<PaymentLink>>(`/links${qs ? `?${qs}` : ''}`),
  })
}

export function useLink(
  id: string | undefined,
  opts: { refetchInterval?: UseQueryOptions<PaymentLink>['refetchInterval'] } = {},
) {
  return useQuery({
    queryKey: ['links', id],
    queryFn: () => apiRequest<PaymentLink>(`/links/${id}`),
    enabled: !!id,
    refetchInterval: opts.refetchInterval,
  })
}

export function useCreateLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; description?: string; amountTRY: string; expiresInHours?: number }) =>
      apiRequest<PaymentLink>('/links', { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['links'] })
    },
  })
}

export function useCancelLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiRequest<PaymentLink>(`/links/${id}/cancel`, { method: 'POST' }),
    onSuccess: (link) => {
      queryClient.invalidateQueries({ queryKey: ['links'] })
      queryClient.setQueryData(['links', link.id], link)
    },
  })
}

/** Retry the best-effort Soroban invoice creation when a link came back with `onchain: null`
 * (POST /links/:id/onchain, 04-BACKEND-HANDOFF.md §1/§3). Can take ~5–10 s (waits for the tx). */
export function useRetryOnchain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiRequest<PaymentLink>(`/links/${id}/onchain`, { method: 'POST' }),
    onSuccess: (link) => {
      queryClient.setQueryData(['links', link.id], link)
      queryClient.invalidateQueries({ queryKey: ['links'] })
    },
  })
}

export function useBalance() {
  return useQuery({
    queryKey: ['balance'],
    queryFn: () => apiRequest<Balance>('/balance'),
    refetchInterval: 5000,
  })
}

export function usePayments(filters: { page?: number; limit?: number } = {}) {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  if (filters.limit) params.set('limit', String(filters.limit))
  const qs = params.toString()

  return useQuery({
    queryKey: ['payments', filters],
    queryFn: () => apiRequest<Paginated<PaymentWithLink>>(`/payments${qs ? `?${qs}` : ''}`),
    refetchInterval: 5000,
  })
}

export function useWithdrawals(filters: { page?: number; limit?: number } = {}) {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  if (filters.limit) params.set('limit', String(filters.limit))
  const qs = params.toString()

  return useQuery({
    queryKey: ['withdrawals', filters],
    queryFn: () => apiRequest<Paginated<Withdrawal>>(`/withdrawals${qs ? `?${qs}` : ''}`),
    refetchInterval: 5000,
  })
}

/** Mock-only dev toggle (03-MERCHANT-WEB.md step 7) — POST /mock/pay/:id isn't part of the
 * real API contract; the button that calls this only renders when VITE_USE_MOCK=true. */
export function useSimulatePayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (linkId: string) => apiRequest<{ accepted: true }>(`/mock/pay/${linkId}`, { method: 'POST' }),
    onSuccess: (_, linkId) => {
      queryClient.invalidateQueries({ queryKey: ['links', linkId] })
    },
  })
}

export function useCreateWithdrawal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { amountTRY: string; iban?: string }) =>
      apiRequest<Withdrawal>('/withdrawals', { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] })
      queryClient.invalidateQueries({ queryKey: ['balance'] })
    },
  })
}

/** GET /usdc-withdrawals. Polls every ~10 s only while some row is still 'submitted' (the backend
 * keeps resubmitting the signed tx until it lands). A 404 means an older backend without the route. */
export function useUsdcWithdrawals(filters: { page?: number; limit?: number } = {}) {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  if (filters.limit) params.set('limit', String(filters.limit))
  const qs = params.toString()

  return useQuery({
    queryKey: ['usdc-withdrawals', filters],
    queryFn: () => apiRequest<GetUsdcWithdrawalsResponse>(`/usdc-withdrawals${qs ? `?${qs}` : ''}`),
    retry: (count, err) => !(err instanceof HttpError && err.statusCode === 404) && count < 2,
    refetchInterval: (query) => (query.state.data?.items.some((w) => w.status === 'submitted') ? 10_000 : false),
  })
}

/** POST /usdc-withdrawals — sends USDC from the platform account to the merchant's own wallet.
 * Returns after ~5 s; the amount leaves its source balance immediately. */
export function useCreateUsdcWithdrawal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: PostUsdcWithdrawalsRequest) =>
      apiRequest<UsdcWithdrawal>('/usdc-withdrawals', { method: 'POST', body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['usdc-withdrawals'] })
      queryClient.invalidateQueries({ queryKey: ['balance'] })
      queryClient.invalidateQueries({ queryKey: ['unallocated'] })
    },
  })
}

/** GET /unallocated — the credits behind Balance.unallocatedUSDC, newest first, plus a `summary`
 * computed over ALL pages (04-BACKEND-HANDOFF.md §2). `limit` ≤ 100. Only fetched while enabled
 * (the drawer is open). */
export function useUnallocated(page: number, limit: number, enabled: boolean) {
  return useQuery({
    queryKey: ['unallocated', page, limit],
    queryFn: () => apiRequest<GetUnallocatedResponse>(`/unallocated?page=${page}&limit=${limit}`),
    enabled,
  })
}
