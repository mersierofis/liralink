import type { AnchorAdapter, SettleContext, SettleOutcome } from './anchor-adapter';

/**
 * In-process anchor for balance mode (Mode A): converts after ANCHOR_MOCK_DELAY_MS, no fee, a
 * deterministic `mock-<id>` reference. The TRY is credited to the merchant's balance.
 */
export class MockAnchorAdapter implements AnchorAdapter {
  readonly name = 'mock' as const;
  readonly settlementMode = 'balance' as const;

  constructor(
    private readonly delayMs: number,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async settle(ctx: SettleContext): Promise<SettleOutcome> {
    if (ctx.settlement.status === 'pending') {
      await ctx.progress({ status: 'processing', anchorRef: `mock-${ctx.settlement.id}`, blockedReason: null });
    }
    await this.sleep(this.delayMs);
    return { kind: 'completed', completion: { amountOutTRY: null, feeUSDC: '0.0000000' } };
  }
}
