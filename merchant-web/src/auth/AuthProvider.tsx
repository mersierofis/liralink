import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { clearToken, getToken, setToken } from '@/api/client'
import { useMe } from '@/api/hooks'
import type { Merchant } from '@/api/types'

interface AuthContextValue {
  merchant: Merchant | undefined
  isAuthenticated: boolean
  isLoading: boolean
  login: (token: string, merchant: Merchant) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [hasToken, setHasToken] = useState(() => getToken() !== null)
  const { data: merchant, isLoading, isError } = useMe(hasToken)

  useEffect(() => {
    // A 401 clears the token in apiRequest and hard-redirects; this covers the case
    // where /me fails for another reason (e.g. token from a stale session).
    if (hasToken && isError) {
      clearToken()
      setHasToken(false)
    }
  }, [hasToken, isError])

  const login = (token: string, merchantData: Merchant) => {
    setToken(token)
    queryClient.setQueryData(['me'], merchantData)
    setHasToken(true)
  }

  const logout = () => {
    clearToken()
    queryClient.removeQueries({ queryKey: ['me'] })
    setHasToken(false)
  }

  return (
    <AuthContext.Provider
      value={{
        merchant,
        isAuthenticated: hasToken && !!merchant,
        isLoading: hasToken && isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
