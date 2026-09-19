/**
 * Kill switch + App ID only — never put App Secret in the frontend.
 * Lives apart from `PrivyGate` so checking it does not pull the Privy SDK into the main bundle.
 */
export function isPrivyEnabled(): boolean {
  return (
    import.meta.env.VITE_PRIVY_ENABLED === 'true' &&
    Boolean(import.meta.env.VITE_PRIVY_APP_ID?.trim())
  )
}
