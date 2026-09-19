import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SettlementTimeline } from './SettlementTimeline'
import type { Settlement } from '@/api/types'

const base: Settlement = {
  id: 's1',
  merchantId: 'm1',
  paymentId: 'p1',
  amountUSDC: '147.0588235',
  amountTRY: '5000.00',
  fxRate: '34.0000000',
  savedUSDC: '0.0000000',
  feeUSDC: null,
  netTRY: null,
  provider: 'mock',
  status: 'pending',
  failReason: null,
  interactiveUrl: null,
  createdAt: '2026-09-19T10:00:00.000Z',
}

describe('SettlementTimeline', () => {
  it('shows no credited amount until the settlement completes', () => {
    render(<SettlementTimeline settlement={base} />)
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.queryByText('Credited', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('shows the net TRY and fee once completed', () => {
    render(
      <SettlementTimeline
        settlement={{ ...base, status: 'completed', netTRY: '4990.00', feeUSDC: '0.1000000', completedAt: '2026-09-19T10:01:00.000Z' }}
      />,
    )
    expect(screen.getByText(/4\.990,00/)).toBeInTheDocument()
    expect(screen.getByText('0.10 USDC')).toBeInTheDocument()
  })

  it('explains a failed settlement and says it is not retried', () => {
    render(<SettlementTimeline settlement={{ ...base, status: 'failed', failReason: 'amount_mismatch' }} />)
    expect(screen.getByText(/amount_mismatch/)).toBeInTheDocument()
    expect(screen.getByText(/will not be retried/)).toBeInTheDocument()
  })
})
