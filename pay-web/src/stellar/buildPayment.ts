import {
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
  Networks,
  Transaction,
} from '@stellar/stellar-sdk'
import type { PayQuote } from '@/api/types'
import { payAmountUSDC } from '@/api/hooks'

export class BuildPaymentError extends Error {
  code: 'no_memo_rail' | 'unfunded' | 'no_trust' | 'underfunded' | 'unknown'

  constructor(code: BuildPaymentError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export function getUsdcBalance(
  account: Horizon.AccountResponse,
  asset: { code: string; issuer: string },
): { hasTrustline: boolean; balance: string } {
  const bal = account.balances.find(
    (b) =>
      b.asset_type !== 'native' &&
      'asset_code' in b &&
      b.asset_code === asset.code &&
      b.asset_issuer === asset.issuer,
  )
  if (!bal || bal.asset_type === 'native') {
    return { hasTrustline: false, balance: '0' }
  }
  return { hasTrustline: true, balance: bal.balance }
}

/**
 * Classic USDC payment with text memo = link code.
 * Destination + memo come from `q.rails.memo` (never top-level).
 */
export async function buildPaymentXdr(q: PayQuote, source: string): Promise<string> {
  const rail = q.rails.memo
  if (!rail?.destination || !rail.memo) {
    throw new BuildPaymentError('no_memo_rail', 'This link has no memo payment rail.')
  }

  const server = new Horizon.Server(import.meta.env.VITE_HORIZON_URL)
  let account: Horizon.AccountResponse
  try {
    account = await server.loadAccount(source)
  } catch {
    throw new BuildPaymentError(
      'unfunded',
      'This Stellar account is not funded on testnet yet. Fund it with Friendbot at lab.stellar.org.',
    )
  }

  const usdc = new Asset(q.asset.code, q.asset.issuer)
  const { hasTrustline, balance } = getUsdcBalance(account, q.asset)
  if (!hasTrustline) {
    throw new BuildPaymentError(
      'no_trust',
      'No USDC trustline on this account. Add one and get testnet USDC from faucet.circle.com.',
    )
  }

  const amount = payAmountUSDC(q)
  if (Number(balance) < Number(amount)) {
    throw new BuildPaymentError(
      'underfunded',
      `Not enough USDC. Need ${amount}, wallet has ${balance}. Get more from faucet.circle.com.`,
    )
  }

  // Memo MUST equal the link code — backend matches payments by memo.
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: rail.destination,
        asset: usdc,
        amount,
      }),
    )
    .addMemo(Memo.text(rail.memo))
    .setTimeout(180)
    .build()

  return tx.toXDR()
}

export async function submitSignedXdr(signedXdr: string): Promise<{ hash: string }> {
  const server = new Horizon.Server(import.meta.env.VITE_HORIZON_URL)
  const tx = new Transaction(signedXdr, Networks.TESTNET)
  try {
    const result = await server.submitTransaction(tx)
    return { hash: result.hash }
  } catch (err: unknown) {
    const horizonErr = err as {
      response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } }
      message?: string
    }
    const codes = horizonErr.response?.data?.extras?.result_codes
    const op = codes?.operations?.[0]
    const txCode = codes?.transaction
    if (op === 'op_underfunded' || txCode === 'tx_insufficient_balance') {
      throw new BuildPaymentError('underfunded', 'Wallet does not have enough XLM or USDC for this payment.')
    }
    if (op === 'op_no_trust') {
      throw new BuildPaymentError('no_trust', 'Destination or source is missing a USDC trustline.')
    }
    if (txCode === 'tx_bad_seq') {
      throw new BuildPaymentError(
        'unknown',
        'Sequence number conflict (tx_bad_seq). Close other pending Freighter prompts and try again.',
      )
    }
    throw new Error(horizonErr.message ?? 'Horizon rejected the transaction.')
  }
}

export async function loadUsdcBalance(
  address: string,
  asset: { code: string; issuer: string },
): Promise<{ hasTrustline: boolean; balance: string; funded: boolean }> {
  const server = new Horizon.Server(import.meta.env.VITE_HORIZON_URL)
  try {
    const account = await server.loadAccount(address)
    return { ...getUsdcBalance(account, asset), funded: true }
  } catch {
    return { hasTrustline: false, balance: '0', funded: false }
  }
}
