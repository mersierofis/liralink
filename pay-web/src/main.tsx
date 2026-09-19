import { Buffer } from 'buffer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'

// After a redeploy, a page still running the previous build asks for chunks and stylesheets that
// no longer exist (e.g. a 404 on the old index-<hash>.css when the lazy Privy chunk loads). Reload
// once to pick up the new build; at most once a minute, so a real outage cannot loop the page.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'liralink:preload-reload-at'
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    return // no storage: let the error surface rather than risk a reload loop
  }
  event.preventDefault()
  window.location.reload()
})

// stellar-sdk expects Buffer in the browser
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

async function enableMocking() {
  if (import.meta.env.VITE_USE_MOCK !== 'true') return
  const { worker } = await import('./mocks/browser')
  return worker.start({ onUnhandledRequest: 'bypass' })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

void enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
})
