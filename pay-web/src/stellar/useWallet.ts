import { useCallback, useState } from 'react'
import { Horizon } from '@stellar/stellar-sdk'
import { isWalletRejection, walletRejectionMessage } from './walletErrors'
import { getWalletKit, WalletNetwork } from './walletKit'

export type WalletErrorKind = 'mainnet' | 'generic'

export type WalletState = {
  address: string | null
  walletId: string | null
  connecting: boolean
  error: string | null
  errorKind: WalletErrorKind | null
}

export class WalletNetworkError extends Error {
  kind: WalletErrorKind

  constructor(kind: WalletErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

async function assertTestnetOrHorizon(address: string): Promise<void> {
  const kit = getWalletKit()
  try {
    const { network, networkPassphrase } = await kit.getNetwork()
    if (/public|mainnet/i.test(network) || networkPassphrase === WalletNetwork.PUBLIC) {
      throw new WalletNetworkError(
        'mainnet',
        'Wallet is on Mainnet. Switch Freighter to Testnet and try again.',
      )
    }
    if (networkPassphrase !== WalletNetwork.TESTNET) {
      throw new WalletNetworkError(
        'mainnet',
        'Wallet is not on Stellar Testnet. Switch Freighter to Testnet.',
      )
    }
    return
  } catch (err) {
    if (err instanceof WalletNetworkError) throw err
    // Some wallets do not implement getNetwork — fall through to Horizon.
  }

  const server = new Horizon.Server(import.meta.env.VITE_HORIZON_URL)
  try {
    await server.loadAccount(address)
  } catch {
    // Unfunded testnet account — not Mainnet. Show Friendbot guidance.
    throw new WalletNetworkError(
      'generic',
      'This Stellar account is not funded on testnet yet. Fund it with Friendbot at lab.stellar.org, then reconnect.',
    )
  }
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    walletId: null,
    connecting: false,
    error: null,
    errorKind: null,
  })

  const connect = useCallback(async () => {
    const kit = getWalletKit()
    setState((s) => ({ ...s, connecting: true, error: null, errorKind: null }))
    try {
      await kit.openModal({
        onWalletSelected: async (option) => {
          try {
            kit.setWallet(option.id)
            const { address } = await kit.getAddress()
            await assertTestnetOrHorizon(address)
            setState({
              address,
              walletId: option.id,
              connecting: false,
              error: null,
              errorKind: null,
            })
          } catch (err) {
            const kind = err instanceof WalletNetworkError ? err.kind : 'generic'
            const message = err instanceof Error ? err.message : 'Failed to connect wallet'
            // Never rethrow — avoids uncaught promise + stuck "Connecting…"
            setState({
              address: null,
              walletId: null,
              connecting: false,
              error: message,
              errorKind: kind,
            })
          }
        },
        onClosed: () => {
          setState((s) => (s.address ? s : { ...s, connecting: false }))
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet'
      setState((s) => ({
        ...s,
        connecting: false,
        error: message,
        errorKind: 'generic',
      }))
    }
  }, [])

  const disconnect = useCallback(() => {
    setState({
      address: null,
      walletId: null,
      connecting: false,
      error: null,
      errorKind: null,
    })
  }, [])

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null, errorKind: null }))
  }, [])

  const signXdr = useCallback(
    async (xdr: string): Promise<string> => {
      if (!state.address) throw new Error('Connect a wallet first')
      const kit = getWalletKit()
      try {
        const { signedTxXdr } = await kit.signTransaction(xdr, {
          address: state.address,
          networkPassphrase: WalletNetwork.TESTNET,
        })
        return signedTxXdr
      } catch (err) {
        if (isWalletRejection(err)) {
          throw new Error(walletRejectionMessage())
        }
        throw err instanceof Error ? err : new Error(String(err))
      }
    },
    [state.address],
  )

  return {
    address: state.address,
    walletId: state.walletId,
    connecting: state.connecting,
    error: state.error,
    errorKind: state.errorKind,
    connect,
    disconnect,
    clearError,
    signXdr,
  }
}
