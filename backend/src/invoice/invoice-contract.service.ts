import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { type LinkWithPayments, withPayments } from '../links/link.mapper';
import { INVOICE_CHAIN, type InvoiceChain } from './invoice-chain';
import { usdcToStroops } from './invoice-contract';

/** How long POST /links waits for the on-chain invoice before answering on the memo rail alone. */
export const REGISTER_BUDGET_MS = 4_000;

/**
 * The contract rail's write side: records links as on-chain invoices and cancels them. Always
 * optional and always best-effort — with no contract configured, or RPC failing or slow, a link
 * still works on the memo rail, and nothing here ever throws into link creation or cancel.
 */
@Injectable()
export class InvoiceContractService {
  private readonly logger = new Logger(InvoiceContractService.name);
  /**
   * Contract calls are signed by the platform account; two in flight at once would race for its
   * sequence number and one would fail. So they run one at a time.
   */
  private queue: Promise<unknown> = Promise.resolve();
  /** How long link creation waits for the invoice; a field so tests can shorten it. */
  budgetMs = REGISTER_BUDGET_MS;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(INVOICE_CHAIN) private readonly chain: InvoiceChain | null,
  ) {}

  /** The configured contract, or null when the contract rail is off. */
  get contractId(): string | null {
    return this.chain?.contractId ?? null;
  }

  /**
   * Records the link on-chain, waiting at most `budgetMs`. Never throws. Returns the link with its
   * on-chain fields if the invoice landed in time; otherwise the link as it was, while the invoice
   * keeps going in the background and fills the fields in if it lands later.
   */
  async registerWithin(link: LinkWithPayments, budgetMs = this.budgetMs): Promise<LinkWithPayments> {
    if (!this.chain) return link;
    const work = this.register(link).catch((err: unknown) => {
      this.logger.warn(`link ${link.code}: no on-chain invoice, memo rail only (retry: POST /links/${link.id}/onchain): ${message(err)}`);
      return null;
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), budgetMs)));
    const result = await Promise.race([work, timeout]);
    clearTimeout(timer);
    if (result === 'timeout') {
      this.logger.warn(`link ${link.code}: on-chain invoice still pending after ${budgetMs} ms; answering on the memo rail, it continues in the background`);
      return link;
    }
    return result ?? link;
  }

  /**
   * Creates the invoice and stores contract id, invoice code, deadline and tx hash on the link.
   * Throws on failure (for the manual retry to report); the link itself is never touched then.
   */
  async register(link: LinkWithPayments): Promise<LinkWithPayments> {
    const chain = this.requireChain();
    const created = await this.serialized(() =>
      chain.create({ code: link.code, amountStroops: usdcToStroops(link.quotedUSDC.toFixed(7)), expiresAt: link.expiresAt }),
    );
    const row = await this.prisma.paymentLink.update({
      where: { id: link.id },
      data: {
        onchainContractId: chain.contractId,
        onchainInvoiceCode: link.code,
        onchainDeadlineLedger: created.deadlineLedger,
        onchainTxHash: created.txHash,
      },
      include: withPayments,
    });
    this.logger.log(`link ${link.code}: on-chain invoice on ${chain.contractId}, deadline ledger ${created.deadlineLedger}, tx ${created.txHash ?? '(already existed)'}`);
    // Cancelled while the invoice was still being created: cancel it on-chain too.
    if (row.status === 'cancelled') void this.cancelBestEffort(row);
    return row;
  }

  /** Cancels the link's invoice if it is on the configured contract. Never throws. */
  async cancelBestEffort(link: Pick<LinkWithPayments, 'code' | 'onchainContractId'>): Promise<void> {
    if (!this.chain || link.onchainContractId !== this.chain.contractId) return;
    const chain = this.chain;
    try {
      const txHash = await this.serialized(() => chain.cancel(link.code));
      this.logger.log(`link ${link.code}: on-chain invoice cancelled, tx ${txHash}`);
    } catch (err) {
      // A payment through the stale invoice is still caught: the link is not open, so it is a stray.
      this.logger.warn(`link ${link.code}: on-chain cancel failed, invoice stays Pending on-chain: ${message(err)}`);
    }
  }

  private requireChain(): InvoiceChain {
    if (!this.chain) throw new Error('the contract rail is off (INVOICE_CONTRACT_ID is empty)');
    return this.chain;
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
