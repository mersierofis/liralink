import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  FREIGHTER_ID,
  xBullModule,
} from '@creit.tech/stellar-wallets-kit'

let kit: StellarWalletsKit | null = null

/**
 * Demo-safe module list: Freighter + xBull only.
 * allowAllModules() pulls Albedo/Ledger/etc. — Albedo has no getNetwork() and can hang connect.
 */
export function getWalletKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: [new FreighterModule(), new xBullModule()],
    })
  }
  return kit
}

export { WalletNetwork, FREIGHTER_ID }
