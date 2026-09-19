import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { PrivySession } from '@/components/PrivyEmailButton'
import PrivyEmailFlow from './PrivyEmailFlow'

// The provider itself is out of scope here: render children as-is.
vi.mock('./PrivyGate', () => ({ PrivyGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

// Like Privy's hooks under a re-rendered provider: a new signHash function on every render.
const startEmail = vi.fn()
vi.mock('./usePrivyPay', () => ({
  usePrivyPay: () => ({
    ready: true,
    phase: 'email',
    address: null,
    email: '',
    code: '',
    busy: false,
    error: null,
    setEmail: vi.fn(),
    setCode: vi.fn(),
    startEmail,
    submitEmail: vi.fn(),
    submitCode: vi.fn(),
    signHash: vi.fn(async () => ({ address: 'G', signature: 'sig' })),
    disconnect: vi.fn(),
  }),
}))

/** Like PayPage: stores the session in state, so every onSession call re-renders the flow. */
function Parent({ onRender }: { onRender: () => void }) {
  const [, setSession] = useState<PrivySession | null>(null)
  onRender()
  // Fail fast instead of hanging the test runner if the loop ever comes back.
  if ((onRender as ReturnType<typeof vi.fn>).mock.calls.length > 20) throw new Error('render loop')
  return <PrivyEmailFlow onSession={setSession} />
}

describe('PrivyEmailFlow', () => {
  it('does not loop when the parent re-renders on onSession (React #185)', () => {
    const onRender = vi.fn()
    render(<Parent onRender={onRender} />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    // Mount, plus at most one re-render from the first onSession; never an update loop.
    expect(onRender.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('reports the session, and signs through the latest signHash', async () => {
    const sessions: PrivySession[] = []
    render(<PrivyEmailFlow onSession={(s) => sessions.push(s)} />)
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    await expect(sessions[sessions.length - 1].signHash('ab')).resolves.toEqual({ address: 'G', signature: 'sig' })
  })
})
