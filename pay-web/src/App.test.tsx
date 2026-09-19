import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotFoundPage } from './pages/NotFoundPage'

function renderPage() {
  render(
    <MemoryRouter>
      <NotFoundPage />
    </MemoryRouter>,
  )
}

describe('NotFoundPage', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('explains that a payment link is required', () => {
    renderPage()
    expect(screen.getByText('No payment link')).toBeInTheDocument()
  })

  it('links "Try demo link" to VITE_DEMO_LINK_CODE', () => {
    vi.stubEnv('VITE_DEMO_LINK_CODE', 'Y82H54DH')
    renderPage()
    expect(screen.getByRole('link', { name: /try demo link/i })).toHaveAttribute('href', '/p/Y82H54DH')
    expect(screen.getByText('/p/Y82H54DH')).toBeInTheDocument()
  })

  it('hides the button when VITE_DEMO_LINK_CODE is unset or blank', () => {
    vi.stubEnv('VITE_DEMO_LINK_CODE', '  ')
    renderPage()
    expect(screen.queryByRole('link', { name: /try demo link/i })).not.toBeInTheDocument()
    expect(screen.getByText(/payment URL the merchant shared/i)).toBeInTheDocument()
  })
})
