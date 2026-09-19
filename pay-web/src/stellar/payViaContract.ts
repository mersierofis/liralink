import { Client } from 'invoice-client'
import { Horizon, rpc } from '@stellar/stellar-sdk'
import type { PayQuote } from '@/api/types'
import { getUsdcBalance } from './buildPayment'
import { isWalletRejection, walletRejectionMessage } from './walletErrors'
import { WalletNetwork } from './walletKit'

const RPC_URL = 'https://soroban-testnet.stellar.org'

export function isContractRailEnabled(): boolean {
  // Default ON; set VITE_CONTRACT_RAIL=false (rebuild/redeploy) to hide / skip contract pay.
  return import.meta.env.VITE_CONTRACT_RAIL !== 'false'
}

/**
 * Pay through the Soroban invoice contract (primary when rails.contract is present).
 * Uses packages/invoice-client; wallet kit signs the assembled tx.
 */
export async function payViaContract(opts: {
  quote: PayQuote
  payer: string
  signXdr: (xdr: string) => Promise<string>
  /** Fired as soon as the tx is accepted by the network (before finalization). */
  onSubmitted?: (hash: string) => void
}): Promise<{ hash: string }> {
  const rail = opts.quote.rails.contract
  if (!rail?.contractId || !rail.invoiceCode) {
    throw new Error('This link has no contract payment rail.')
  }

  // Preflight: same trustline / balance checks as the memo rail (friendly copy, not HostError).
  const horizon = new Horizon.Server(import.meta.env.VITE_HORIZON_URL)
  let account: Horizon.AccountResponse
  try {
    account = await horizon.loadAccount(opts.payer)
  } catch {
    throw new Error(
      'This Stellar account is not funded on testnet yet. Fund it with Friendbot at lab.stellar.org.',
    )
  }
  const { hasTrustline, balance } = getUsdcBalance(account, opts.quote.asset)
  if (!hasTrustline) {
    throw new Error(
      'No USDC trustline on this account. Add one and get testnet USDC from faucet.circle.com.',
    )
  }
  const amount = opts.quote.amountUSDC
  if (Number(balance) < Number(amount)) {
    throw new Error(
      `Not enough USDC. Need ${amount}, wallet has ${balance}. Get more from faucet.circle.com.`,
    )
  }

  const client = new Client({
    contractId: rail.contractId,
    networkPassphrase: WalletNetwork.TESTNET,
    rpcUrl: RPC_URL,
    publicKey: opts.payer,
  })

  let assembled
  try {
    assembled = await client.pay({
      code: rail.invoiceCode,
      payer: opts.payer,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Contract simulation failed: ${msg}`)
  }

  // client.pay() stores a failed simulation without throwing; SimulationFailed is deferred
  // until signAndSend → sign accesses simulationData. Surface it before any wallet prompt.
  const simulation = assembled.simulation
  if (simulation && rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Contract simulation failed: ${simulation.error}`)
  }
  try {
    // Touch simulationData so ExpiredState / other deferred errors also surface here.
    void assembled.simulationData
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Contract simulation failed: ${msg}`)
  }

  let submittedHash: string | undefined
  try {
    const sent = await assembled.signAndSend({
      signTransaction: async (xdr: string) => {
        const signedTxXdr = await opts.signXdr(xdr)
        return { signedTxXdr }
      },
      watcher: {
        onSubmitted(response) {
          const hash = response?.hash
          if (hash) {
            submittedHash = hash
            opts.onSubmitted?.(hash)
          }
        },
      },
    })

    const status = sent.getTransactionResponse?.status
    if (status === rpc.Api.GetTransactionStatus.FAILED) {
      const hash =
        submittedHash ??
        sent.sendTransactionResponse?.hash ??
        sent.getTransactionResponse?.txHash
      throw new Error(
        hash
          ? `Contract transaction failed on-chain (${hash}).`
          : 'Contract transaction failed on-chain.',
      )
    }

    const hash =
      submittedHash ??
      sent.sendTransactionResponse?.hash ??
      (sent as { hash?: string }).hash ??
      sent.getTransactionResponse?.txHash
    if (!hash) {
      throw new Error('Contract pay submitted but no tx hash was returned.')
    }
    return { hash }
  } catch (err) {
    // StillPending: hash was already reported via onSubmitted — return it so UI can poll.
    const errName =
      err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : ''
    if (errName === 'TransactionStillPending' && submittedHash) {
      return { hash: submittedHash }
    }
    if (isWalletRejection(err)) {
      throw new Error(walletRejectionMessage())
    }
    throw err instanceof Error ? err : new Error(String(err))
  }
}
