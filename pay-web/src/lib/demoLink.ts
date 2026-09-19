/**
 * Code of the live demo link, from VITE_DEMO_LINK_CODE (build-time, so it changes with a redeploy,
 * not a code change). Null when unset: the "Try demo link" button is then hidden.
 */
export function demoLinkCode(): string | null {
  const code = import.meta.env.VITE_DEMO_LINK_CODE?.trim()
  return code ? code : null
}
