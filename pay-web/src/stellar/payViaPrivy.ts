import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import type { PayQuote } from '@/api/types'
import { payAmountUSDC } from '@/api/hooks'
import { BuildPaymentError, getUsdcBalance } from '@/stellar/buildPayment'
import { signWithPrivy } from '@/stellar/setupPrivyWallet'

/**
 * Build memo-rail payment, sign tx hash via Privy `signRawHash`, submit to Horizon.
 * App Secret is never used here — only the user's Privy session + App ID.
 */
export async function payViaPrivy(opts: {
  quote: PayQuote
  address: string
  signHash: (hashHex: string) => Promise<{ signature: string }>
}): Promise<{ hash: string }> {
  const { quote, address, signHash } = opts
  const rail = quote.rails.memo
  if (!rail?.destination || !rail.memo) {
    throw new BuildPaymentError('no_memo_rail', 'This link has no memo payment rail.')
  }

  const server = new Horizon.Server(import.meta.env.VITE_HORIZON_URL)
  let account: Horizon.AccountResponse
  try {
    account = await server.loadAccount(address)
  } catch {
    throw new BuildPaymentError(
      'unfunded',
      'This Stellar account is not funded on testnet yet. Fund it with Friendbot, then retry.',
    )
  }

  const usdc = new Asset(quote.asset.code, quote.asset.issuer)
  const { hasTrustline, balance } = getUsdcBalance(account, quote.asset)
  if (!hasTrustline) {
    throw new BuildPaymentError(
      'no_trust',
      'This email wallet has no USDC trustline yet. Sign out and sign in again to finish setting it up.',
    )
  }

  const amount = payAmountUSDC(quote)
  if (Number(balance) < Number(amount)) {
    throw new BuildPaymentError(
      'underfunded',
      `Not enough USDC. Need ${amount}, wallet has ${balance}. Get more from faucet.circle.com.`,
    )
  }

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

  await signWithPrivy(tx, address, signHash)
  const result = await server.submitTransaction(tx)
  return { hash: result.hash }
}
