import type { FxProvider, FxQuote } from './fx.types';

/** Fixed rate from FX_MOCK_RATE_TRY_PER_USDC, no spread. For tests and offline development. */
export class MockFxProvider implements FxProvider {
  constructor(private readonly rate: string) {}

  async getRate(): Promise<FxQuote> {
    return { rate: this.rate, midRate: this.rate, spread: '0', source: 'mock', fetchedAt: new Date(), raw: null };
  }
}
