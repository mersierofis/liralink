import { Decimal } from 'decimal.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { debitUsdc, seed, state, unallocatedSummary } from './data'

beforeEach(() => seed())

describe('mock USDC balances', () => {
  it('debits the chosen source and refuses to overdraw it', () => {
    expect(debitUsdc('saved', new Decimal('2.5'))).toBe(true)
    expect(state.savedUSDC).toBe('5.9000000')
    expect(debitUsdc('saved', new Decimal('100'))).toBe(false)
    expect(state.savedUSDC).toBe('5.9000000')
  })

  it('keeps the unallocated summary consistent with the credits and withdrawals', () => {
    expect(unallocatedSummary()).toEqual({
      creditedUSDC: '12.5000000',
      withdrawnUSDC: '0.0000000',
      remainingUSDC: '12.5000000',
    })
    debitUsdc('unallocated', new Decimal('2'))
    expect(unallocatedSummary().remainingUSDC).toBe('10.5000000')
  })
})
