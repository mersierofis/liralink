/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_USE_MOCK: string
  readonly VITE_EXPLORER_TX_URL: string
  readonly VITE_EXPLORER_ACCOUNT_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
