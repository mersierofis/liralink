import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrivySession } from '@/components/PrivyEmailButton'
import PrivyEmailFlow from './PrivyEmailFlow'

// The provider itself is out of scope here: render children as-is.
vi.mock('./PrivyGate', () => ({ PrivyGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

// Like Privy's hooks under a re-rendered provider: a new signHash function on every render.
const startEmail = vi.fn()
const state = vi.hoisted(() => ({ address: null as string | null, phase: 'email' }))
vi.mock('./usePrivyPay', () => ({
  usePrivyPay: () => ({
    ready: true,
    phase: state.phase,
    address: state.address,
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

const setup = vi.hoisted(() => ({ run: vi.fn(), balance: vi.fn() }))
vi.mock('@/stellar/setupPrivyWallet', async (orig) => ({
  ...(await orig<typeof import('@/stellar/setupPrivyWallet')>()),
  setupPrivyWallet: setup.run,
  privyUsdcBalance: setup.balance,
}))

const USDC = { code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' }
const WALLET = 'GBRZSG7K6ZXJRCMYM2O2HO2DKR7RO2ACZ5FARBMQZBB4YZMDFDXFUTV7'

beforeEach(() => {
  state.address = null
  state.phase = 'email'
  setup.run.mockReset()
  setup.balance.mockReset()
})

/** Like PayPage: stores the session in state, so every onSession call re-renders the flow. */
function Parent({ onRender }: { onRender: () => void }) {
  const [, setSession] = useState<PrivySession | null>(null)
  onRender()
  // Fail fast instead of hanging the test runner if the loop ever comes back.
  if ((onRender as ReturnType<typeof vi.fn>).mock.calls.length > 20) throw new Error('render loop')
  return <PrivyEmailFlow onSession={setSession} asset={USDC} amountUSDC="1.0000000" />
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
    render(<PrivyEmailFlow onSession={(s) => sessions.push(s)} asset={USDC} amountUSDC="1.0000000" />)
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    await expect(sessions[sessions.length - 1].signHash('ab')).resolves.toEqual({ address: 'G', signature: 'sig' })
  })

  describe('a signed-in wallet is set up before the pay page sees it', () => {
    beforeEach(() => {
      state.address = WALLET
      state.phase = 'ready'
    })

    it('shows "setting up your wallet" and hides the address from the pay page meanwhile', () => {
      setup.run.mockImplementation(({ onStep }) => {
        onStep('funding')
        return new Promise(() => undefined)
      })
      const sessions: PrivySession[] = []
      render(<PrivyEmailFlow onSession={(s) => sessions.push(s)} asset={USDC} amountUSDC="1.0000000" />)
      expect(screen.getByRole('status')).toHaveTextContent('Setting up your wallet: activating it on Stellar testnet')
      expect(sessions.every((s) => s.address === null)).toBe(true)
    })

    it('funded but empty: shows the address and the faucet instruction, and tells the page the balance', async () => {
      setup.run.mockResolvedValue({ usdcBalance: '0.0000000' })
      setup.balance.mockResolvedValue('0.0000000')
      const sessions: PrivySession[] = []
      render(<PrivyEmailFlow onSession={(s) => sessions.push(s)} asset={USDC} amountUSDC="1.0000000" />)
      expect(await screen.findByText(WALLET)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'faucet.circle.com' })).toHaveAttribute('href', 'https://faucet.circle.com')
      expect(sessions[sessions.length - 1]).toMatchObject({ address: WALLET, usdcBalance: '0.0000000' })
      expect(setup.run).toHaveBeenCalledWith(expect.objectContaining({ address: WALLET, asset: USDC }))
    })

    it('holding enough USDC: "Wallet ready"', async () => {
      setup.run.mockResolvedValue({ usdcBalance: '5.0000000' })
      render(<PrivyEmailFlow asset={USDC} amountUSDC="1.0000000" />)
      expect(await screen.findByText(/Wallet ready · 5.0000000 USDC/)).toBeInTheDocument()
    })

    it('setup failure: the error and a retry that runs setup again', async () => {
      setup.run.mockRejectedValueOnce(new Error('Friendbot could not fund the wallet (HTTP 502)'))
      setup.run.mockResolvedValueOnce({ usdcBalance: '5.0000000' })
      render(<PrivyEmailFlow asset={USDC} amountUSDC="1.0000000" />)
      expect(await screen.findByText(/HTTP 502/)).toBeInTheDocument()
      screen.getByRole('button', { name: 'Try again' }).click()
      await waitFor(() => expect(screen.getByText(/Wallet ready/)).toBeInTheDocument())
      expect(setup.run).toHaveBeenCalledTimes(2)
    })
  })
})
