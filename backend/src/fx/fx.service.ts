import { Injectable } from '@nestjs/common';
import { Networks } from '@stellar/stellar-sdk';
import { AppConfig } from '../config/app-config';
import { AnchorFxProvider } from './anchor-fx.provider';
import type { FxProvider, FxQuote } from './fx.types';
import { MockFxProvider } from './mock-fx.provider';

export type { FxQuote } from './fx.types';

/** USDC/TRY rate source chosen by FX_PROVIDER: `anchor` (SEP-38, the default) or `mock`. */
@Injectable()
export class FxService {
  private readonly provider: FxProvider;

  constructor(config: AppConfig) {
    const env = config.env;
    this.provider =
      env.FX_PROVIDER === 'anchor'
        ? new AnchorFxProvider({
            homeDomain: env.ANCHOR_HOME_DOMAIN!,
            usdcIssuer: env.USDC_ISSUER,
            networkPassphrase: env.NETWORK_PASSPHRASE ?? Networks.TESTNET,
          })
        : new MockFxProvider(env.FX_MOCK_RATE_TRY_PER_USDC!);
  }

  /** A fresh rate. Throws FxUnavailableError rather than ever returning a stale or guessed one. */
  getRate(): Promise<FxQuote> {
    return this.provider.getRate();
  }
}
