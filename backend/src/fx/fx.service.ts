import { Injectable } from '@nestjs/common';
import type { FxSource } from '../contract/api.types';
import { AppConfig } from '../config/app-config';

export interface FxQuote {
  /** TRY per 1 USDC, decimal string. */
  rate: string;
  source: FxSource;
}

/** USDC/TRY rate source. Only `mock` exists so far; config refuses to boot with any other provider. */
@Injectable()
export class FxService {
  constructor(private readonly config: AppConfig) {}

  async getRate(): Promise<FxQuote> {
    return { rate: this.config.env.FX_MOCK_RATE_TRY_PER_USDC, source: 'mock' };
  }
}
