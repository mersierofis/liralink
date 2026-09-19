import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import App from './App'

function renderApp() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

describe('App', () => {
  it('redirects an unauthenticated visitor to /login', async () => {
    renderApp()
    expect(await screen.findByText('Sign in to LiraLink')).toBeInTheDocument()
  })
})
