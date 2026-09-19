import { PrivyProvider, type PrivyClientConfig } from '@privy-io/react-auth'
import type { ReactNode } from 'react'
import { isPrivyEnabled } from './enabled'

// Module-level, so the provider sees the same config object on every render. A fresh literal
// here re-initialised Privy on each parent re-render and gave its hooks new identities (React #185).
const PRIVY_CONFIG: PrivyClientConfig = {
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
}

/** Only mounted by the lazy `PrivyEmailFlow` chunk — never import this from eagerly loaded code. */
export function PrivyGate({ children }: { children: ReactNode }) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim()
  if (!isPrivyEnabled() || !appId) return <>{children}</>
  return (
    <PrivyProvider
      appId={appId}
      config={PRIVY_CONFIG}
    >
      {children}
    </PrivyProvider>
  )
}
