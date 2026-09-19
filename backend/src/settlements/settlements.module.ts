import { Module } from '@nestjs/common';
import { Asset, Keypair, Networks } from '@stellar/stellar-sdk';
import { AppConfig } from '../config/app-config';
import { ListenerModule } from '../listener/listener.module';
import { isLoopbackHttp } from '../listener/payment-source';
import { ANCHOR_ADAPTERS, type AnchorAdapter } from './anchor/anchor-adapter';
import { AnchorHttp } from './anchor/anchor-http';
import { AnchorSession } from './anchor/anchor-session';
import { MockAnchorAdapter } from './anchor/mock.adapter';
import { Sep6Adapter } from './anchor/sep6.adapter';
import { HorizonStellarPayer } from './anchor/stellar-payer';
import { BalanceService } from './balance.service';
import { MoneyController } from './money.controller';
import { SettlementsService } from './settlements.service';

const MOCK_DELAY_DEFAULT_MS = 3_000;

/**
 * Every adapter that can be built from the config. sep6 exists whenever ANCHOR_HOME_DOMAIN is set,
 * so its settlements keep going even after ANCHOR_PROVIDER is switched back to mock (anchor.md,
 * roll back). No sep24 adapter yet: sep24 settlements stay pending.
 */
export function buildAnchorAdapters(config: AppConfig): AnchorAdapter[] {
  const env = config.env;
  const adapters: AnchorAdapter[] = [new MockAnchorAdapter(env.ANCHOR_MOCK_DELAY_MS ?? MOCK_DELAY_DEFAULT_MS)];
  if (env.ANCHOR_HOME_DOMAIN) {
    const keypair = Keypair.fromSecret(env.PLATFORM_ACCOUNT_SECRET);
    const networkPassphrase = env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
    const http = new AnchorHttp();
    adapters.push(
      new Sep6Adapter({
        session: new AnchorSession({ homeDomain: env.ANCHOR_HOME_DOMAIN, networkPassphrase, keypair, http }),
        http,
        payer: new HorizonStellarPayer(env.HORIZON_URL, keypair, new Asset(env.USDC_CODE, env.USDC_ISSUER), networkPassphrase, isLoopbackHttp(env.HORIZON_URL)),
        usdcIssuer: env.USDC_ISSUER,
      }),
    );
  }
  return adapters;
}

@Module({
  imports: [ListenerModule],
  controllers: [MoneyController],
  providers: [
    SettlementsService,
    BalanceService,
    { provide: ANCHOR_ADAPTERS, inject: [AppConfig], useFactory: buildAnchorAdapters },
  ],
  exports: [SettlementsService],
})
export class SettlementsModule {}
