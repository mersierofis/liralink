import { Keypair } from '@stellar/stellar-sdk';
import type { AnchorProvider, SettlementMode } from '../contract/api.types';
import type { Env } from './env';

/** Typed, validated configuration plus the values derived from it. Built by ConfigModule. */
export class AppConfig {
  /** Public key (G…) of the platform collection account. */
  readonly platformAccount: string;
  readonly settlementMode: SettlementMode;

  constructor(readonly env: Env) {
    this.platformAccount = Keypair.fromSecret(env.PLATFORM_ACCOUNT_SECRET).publicKey();
    this.settlementMode = settlementModeFor(env.ANCHOR_PROVIDER);
  }

  get anchorProvider(): AnchorProvider {
    return this.env.ANCHOR_PROVIDER;
  }

  explorerTxUrl(txHash: string): string {
    return `https://stellar.expert/explorer/${this.env.STELLAR_NETWORK}/tx/${txHash}`;
  }
}

/** balance: TRY accrues and the merchant withdraws (mock) · auto_payout: the anchor pays the IBAN (sep6/sep24). */
export function settlementModeFor(provider: AnchorProvider): SettlementMode {
  return provider === 'mock' ? 'balance' : 'auto_payout';
}
