import { describe, expect, it } from 'vitest'
import { payAmountUSDC } from './hooks'

describe('payAmountUSDC', () => {
  it('returns the full quote when open', () => {
    expect(
      payAmountUSDC({
        status: 'open',
        amountUSDC: '10.0000000',
      }),
    ).toBe('10.0000000')
  })

  it('returns shortfall when underpaid', () => {
    expect(
      payAmountUSDC({
        status: 'underpaid',
        amountUSDC: '5.0000000',
        shortfallUSDC: '2.0000000',
      }),
    ).toBe('2.0000000')
  })
})
