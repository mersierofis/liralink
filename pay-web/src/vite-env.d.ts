/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_USE_MOCK: string
  readonly VITE_HORIZON_URL: string
  readonly VITE_EXPLORER_TX_URL: string
  readonly VITE_CONTRACT_RAIL: string
  /** Code of the live demo link for "Try demo link" on /; empty hides the button. */
  readonly VITE_DEMO_LINK_CODE?: string
  /** Set true, with the App ID, to show "Sign in with email". */
  readonly VITE_PRIVY_ENABLED?: string
  /** Public Privy App ID only — never put App Secret in VITE_*. */
  readonly VITE_PRIVY_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
