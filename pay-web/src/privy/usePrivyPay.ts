import { useCallback, useMemo, useState } from 'react'
import { useLoginWithEmail, usePrivy } from '@privy-io/react-auth'
import { useCreateWallet, useSignRawHash } from '@privy-io/react-auth/extended-chains'

type Phase = 'idle' | 'email' | 'code' | 'ready'

/**
 * Secondary payer path: email OTP → Stellar embedded wallet → raw hash sign.
 * Must render under `PrivyGate` (App ID only — App Secret stays on the backend).
 */
export function usePrivyPay() {
  const { ready, authenticated, logout, user } = usePrivy()
  const { sendCode, loginWithCode } = useLoginWithEmail()
  const { createWallet } = useCreateWallet()
  const { signRawHash } = useSignRawHash()

  const [phase, setPhase] = useState<Phase>('idle')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stellarAddress, setStellarAddress] = useState<string | null>(null)

  const existingStellar = useMemo(() => {
    const wallets = user?.linkedAccounts ?? []
    for (const w of wallets) {
      if (
        w.type === 'wallet' &&
        'chainType' in w &&
        (w as { chainType?: string }).chainType === 'stellar' &&
        'address' in w
      ) {
        return (w as { address: string }).address
      }
    }
    return null
  }, [user])

  const address = stellarAddress ?? existingStellar

  const ensureStellarWallet = useCallback(async () => {
    if (address) return address
    setBusy(true)
    setError(null)
    try {
      const { wallet } = await createWallet({ chainType: 'stellar' })
      setStellarAddress(wallet.address)
      setPhase('ready')
      return wallet.address
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not create Stellar wallet'
      setError(msg)
      throw e
    } finally {
      setBusy(false)
    }
  }, [address, createWallet])

  const startEmail = useCallback(() => {
    setPhase('email')
    setError(null)
  }, [])

  const submitEmail = useCallback(async () => {
    if (!email.trim()) {
      setError('Enter your email')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await sendCode({ email: email.trim() })
      setPhase('code')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send code')
    } finally {
      setBusy(false)
    }
  }, [email, sendCode])

  const submitCode = useCallback(async () => {
    if (!code.trim()) {
      setError('Enter the code from your email')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await loginWithCode({ code: code.trim() })
      const addr = await ensureStellarWallet()
      setStellarAddress(addr)
      setPhase('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }, [code, loginWithCode, ensureStellarWallet])

  const signHash = useCallback(
    async (hashHex: string) => {
      const addr = address ?? (await ensureStellarWallet())
      const hash = (hashHex.startsWith('0x') ? hashHex : `0x${hashHex}`) as `0x${string}`
      const { signature } = await signRawHash({
        address: addr,
        chainType: 'stellar',
        hash,
      })
      return { address: addr, signature }
    },
    [address, ensureStellarWallet, signRawHash],
  )

  const disconnect = useCallback(async () => {
    setStellarAddress(null)
    setPhase('idle')
    setEmail('')
    setCode('')
    setError(null)
    if (authenticated) await logout()
  }, [authenticated, logout])

  return {
    enabled: true as const,
    ready,
    phase: authenticated && address ? ('ready' as const) : phase,
    address,
    email,
    code,
    busy,
    error,
    setEmail,
    setCode,
    startEmail,
    submitEmail,
    submitCode,
    ensureStellarWallet,
    signHash,
    disconnect,
  }
}
