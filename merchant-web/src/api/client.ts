import type { ApiError } from './types'

const API_URL = import.meta.env.VITE_API_URL as string

const TOKEN_KEY = 'liralink.token'

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY)
}

export class HttpError extends Error {
  statusCode: number
  error?: string

  constructor(body: ApiError) {
    super(Array.isArray(body.message) ? body.message.join('; ') : body.message)
    this.statusCode = body.statusCode
    this.error = body.error
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  auth?: boolean
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = opts

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && auth) {
    clearToken()
    if (typeof window !== 'undefined') {
      window.location.assign('/login')
    }
  }

  if (!res.ok) {
    let payload: ApiError
    try {
      payload = await res.json()
    } catch {
      payload = { statusCode: res.status, message: res.statusText }
    }
    throw new HttpError(payload)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
