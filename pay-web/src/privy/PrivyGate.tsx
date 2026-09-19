import { PrivyProvider } from '@privy-io/react-auth'
import type { ReactNode } from 'react'
import { isPrivyEnabled } from './enabled'

/** Only mounted by the lazy `PrivyEmailFlow` chunk — never import this from eagerly loaded code. */
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
