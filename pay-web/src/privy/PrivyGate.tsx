import { PrivyProvider } from '@privy-io/react-auth'
import type { ReactNode } from 'react'

/** Kill switch + App ID only — never put App Secret in the frontend. */
export function isPrivyEnabled(): boolean {
  return (
    import.meta.env.VITE_PRIVY_ENABLED === 'true' &&
    Boolean(import.meta.env.VITE_PRIVY_APP_ID?.trim())
  )
}

export function PrivyGate({ children }: { children: ReactNode }) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim()
  if (!isPrivyEnabled() || !appId) return <>{children}</>
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email'],
        appearance: {
          theme: 'light',
          accentColor: '#0f172a',
          logo: undefined,
        },
        embeddedWallets: {
          ethereum: { createOnLogin: 'off' },
          solana: { createOnLogin: 'off' },
        },
      }}
    >
      {children}
    </PrivyProvider>
  )
}
