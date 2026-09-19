import { Buffer } from 'buffer'
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk'
import { getUsdcBalance } from '@/stellar/buildPayment'

export type SetupStep = 'checking' | 'funding' | 'trustline'

const FRIENDBOT_URL = 'https://friendbot.stellar.org'

/**
 * Signs `tx` with a Privy embedded Stellar wallet: Privy signs the raw transaction hash, and the
 * signature is checked against the address before it is attached, so a bad signature never
 * reaches Horizon.
 */
export async function signWithPrivy(
  tx: ReturnType<TransactionBuilder['build']>,
  address: string,
  signHash: (hashHex: string) => Promise<{ signature: string }>,
): Promise<void> {
  const hashHex = tx.hash().toString('hex')
  const { signature } = await signHash(hashHex)
  const sigBytes = Buffer.from(signature.startsWith('0x') ? signature.slice(2) : signature, 'hex')
  if (!Keypair.fromPublicKey(address).verify(Buffer.from(hashHex, 'hex'), sigBytes)) {
    throw new Error('Privy signature did not verify against the Stellar address')
  }
  tx.addSignature(address, sigBytes.toString('base64'))
}

async function loadOrNull(server: Horizon.Server, address: string): Promise<Horizon.AccountResponse | null> {
  try {
    return await server.loadAccount(address)
  } catch (e) {
    if ((e as { response?: { status?: number } }).response?.status === 404) return null
    throw e
  }
}

/**
 * Testnet only. A new Privy wallet exists as a key but not on the ledger, so it can hold no USDC.
 * This funds it with Friendbot (XLM for the reserves and fees) and adds the USDC trustline, signed
 * by the wallet. Each step is skipped when already done, so it is safe to run again.
 * Resolves with the wallet's USDC balance.
 */
export async function setupPrivyWallet(opts: {
  address: string
  asset: { code: string; issuer: string }
  signHash: (hashHex: string) => Promise<{ signature: string }>
  horizonUrl: string
  onStep?: (step: SetupStep) => void
}): Promise<{ usdcBalance: string }> {
  const { address, asset, signHash, horizonUrl, onStep } = opts
  const server = new Horizon.Server(horizonUrl)

  onStep?.('checking')
  let account = await loadOrNull(server, address)

  if (!account) {
    onStep?.('funding')
    const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`)
    // 400 when the account already exists (a second tab funded it meanwhile): fine, reload below.
    if (!res.ok && res.status !== 400) throw new Error(`Friendbot could not fund the wallet (HTTP ${res.status})`)
    account = await loadOrNull(server, address)
    if (!account) throw new Error('The wallet was funded but is not on the ledger yet. Try again in a few seconds.')
  }

  if (!getUsdcBalance(account, asset).hasTrustline) {
    onStep?.('trustline')
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.changeTrust({ asset: new Asset(asset.code, asset.issuer) }))
      .setTimeout(180)
      .build()
    await signWithPrivy(tx, address, signHash)
    await server.submitTransaction(tx)
    account = await server.loadAccount(address)
  }

  return { usdcBalance: getUsdcBalance(account, asset).balance }
}

/** Current USDC balance of a set-up wallet; '0' if it has no trustline or is not on the ledger. */
export async function privyUsdcBalance(address: string, asset: { code: string; issuer: string }, horizonUrl: string): Promise<string> {
  const account = await loadOrNull(new Horizon.Server(horizonUrl), address)
  return account ? getUsdcBalance(account, asset).balance : '0'
}

/** "1.5" → 15000000n: exact, no floating point. */
function stroops(amount: string): bigint {
  const [whole, frac = ''] = amount.split('.')
  return BigInt(whole || '0') * 10_000_000n + BigInt((frac + '0000000').slice(0, 7))
}

/** True when `balance` covers `amount` (both USDC decimal strings). */
export function coversAmount(balance: string, amount: string): boolean {
  return stroops(balance) >= stroops(amount)
}
