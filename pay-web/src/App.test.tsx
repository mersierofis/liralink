import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { NotFoundPage } from './pages/NotFoundPage'

describe('NotFoundPage', () => {
  it('explains that a payment link is required', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('No payment link')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /try demo link/i })).toHaveAttribute(
      'href',
      '/p/DEMO0001',
    )
  })
})
