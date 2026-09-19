import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { PaymentProcessor } from '../listener/payment-processor';
import { PrismaService } from '../prisma/prisma.service';
import { type EventsFrom, INVOICE_CHAIN, type InvoiceChain } from './invoice-chain';

const POLL_MS = 5_000;

/**
 * The contract rail's read side: polls the invoice contract's `paid` events over Soroban RPC and
 * credits each through PaymentProcessor, like a memo payment. The cursor is kept per contract
 * (`soroban-invoice:<contractId>`), so a redeploy starts fresh. A failed poll is logged and retried
 * on the next tick from the saved cursor; it never stops the API or the Horizon listener.
 */
@Injectable()
export class InvoiceWatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InvoiceWatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: PaymentProcessor,
    @Optional() @Inject(INVOICE_CHAIN) private readonly chain: InvoiceChain | null,
  ) {}

  get stream(): string | null {
    return this.chain ? `soroban-invoice:${this.chain.contractId}` : null;
  }

  onApplicationBootstrap(): void {
    if (!this.chain) {
      this.logger.log('contract rail off (INVOICE_CONTRACT_ID empty): memo rail only');
      return;
    }
    this.logger.log(`watching paid events of invoice contract ${this.chain.contractId}`);
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** One poll, unless one is already running. Never throws. */
  poll(): Promise<void> {
    this.running ??= this.drain()
      .catch((err: unknown) => this.logger.error(`invoice event poll failed, retrying in ${POLL_MS} ms: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => (this.running = null));
    return this.running;
  }

  /** Reads and credits every page after the saved cursor. The cursor moves only after its page is credited. */
  private async drain(): Promise<void> {
    const chain = this.chain!;
    const stream = this.stream!;
    for (;;) {
      const saved = await this.prisma.listenerCursor.findUnique({ where: { stream } });
      const from: EventsFrom = saved ? { cursor: saved.pagingToken } : { fromOldestRetained: true };
      const page = await chain.paidEvents(from);
      for (const paid of page.events) {
        const { outcome } = await this.processor.processContractPaid(paid);
        this.logger.log(`contract paid event ${paid.eventId} (${paid.code}, ${paid.amountUSDC} USDC) tx ${paid.txHash} → ${outcome}`);
      }
      await this.prisma.listenerCursor.upsert({ where: { stream }, create: { stream, pagingToken: page.cursor }, update: { pagingToken: page.cursor } });
      if (!page.more) return;
    }
  }
}
