import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { AnchorProvider, Paginated, PageQuery, Settlement } from '../contract/api.types';
import { AppConfig } from '../config/app-config';
import { formatTRY, formatUSDC } from '../common/money';
import { pageWindow } from '../common/pagination.dto';
import type { Merchant as MerchantRow, Prisma, Settlement as SettlementRow } from '../generated/prisma/client';
import { PaymentEvents } from '../listener/payment-events';
import { PrismaService, isUniqueViolation } from '../prisma/prisma.service';
import { ANCHOR_ADAPTERS, type AnchorAdapter, type Progress, type SettleContext } from './anchor/anchor-adapter';
import { redactIban } from './anchor/anchor-http';
import { toSettlement } from './settlement.mapper';
import { bookCompletion, splitForSettlement } from './settlement-math';

/** The job: at boot and every minute. The event is the fast path; this is the guarantee. */
export const SETTLEMENT_JOB_MS = 60_000;

/**
 * Settles paid links. A link is paid → one settlement (unique linkId) → driven through the anchor
 * adapter of the provider it was CREATED with, until completed or failed.
 *
 * `payment.detected` is in-process and fires once: a crash between the payment and its settlement
 * would lose it. So the job also creates the settlement of every paid link that has none, and
 * resumes every settlement that is not finished. Within this process a settlement never has two
 * adapter calls in flight.
 */
@Injectable()
export class SettlementsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SettlementsService.name);
  private readonly adapters: Map<AnchorProvider, AnchorAdapter>;
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly warnedNoAdapter = new Set<AnchorProvider>();
  private timer: NodeJS.Timeout | null = null;
  private job: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly events: PaymentEvents,
    @Inject(ANCHOR_ADAPTERS) adapters: AnchorAdapter[],
  ) {
    this.adapters = new Map(adapters.map((a) => [a.name, a]));
  }

  onApplicationBootstrap(): void {
    this.events.onPaymentDetected((e) => void this.settleLink(e.linkId));
    this.timer = setInterval(() => void this.runJob(), SETTLEMENT_JOB_MS);
    void this.runJob();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([this.job, ...this.inFlight.values()]);
  }

  /** Fast path, from payment.detected. */
  async settleLink(linkId: string): Promise<void> {
    try {
      const s = await this.ensureSettlement(linkId);
      if (s) await this.run(s.id);
    } catch (err) {
      this.logger.error(`settling link ${linkId}: ${describe(err)} — the job will retry`);
    }
  }

  /** The guarantee: every paid link gets a settlement, every unfinished settlement moves on. */
  runJob(): Promise<void> {
    if (this.job) return this.job;
    this.job = (async () => {
      try {
        const orphans = await this.prisma.paymentLink.findMany({ where: { status: 'paid', settlement: null }, select: { id: true } });
        for (const { id } of orphans) {
          if (this.stopped) return;
          this.logger.warn(`link ${id} is paid but has no settlement; creating it`);
          await this.settleLink(id);
        }
        const open = await this.prisma.settlement.findMany({ where: { status: { in: ['pending', 'processing'] } }, select: { id: true }, orderBy: { createdAt: 'asc' } });
        for (const { id } of open) {
          if (this.stopped) return;
          await this.run(id);
        }
      } catch (err) {
        this.logger.error(`settlement job: ${describe(err)}`);
      } finally {
        this.job = null;
      }
    })();
    return this.job;
  }

  /**
   * Creates the link's settlement once. The unique linkId makes a second creation — event and job
   * racing, a replay, two instances — a no-op that returns the existing one.
   */
  async ensureSettlement(linkId: string): Promise<SettlementRow | null> {
    const existing = await this.prisma.settlement.findUnique({ where: { linkId } });
    if (existing) return existing;
    const link = await this.prisma.paymentLink.findUnique({
      where: { id: linkId },
      include: { merchant: true, payments: { orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }], take: 1 } },
    });
    if (!link || link.status !== 'paid' || link.payments.length === 0) return null;
    const split = splitForSettlement(
      { amountTRY: formatTRY(link.amountTRY), quotedUSDC: formatUSDC(link.quotedUSDC) },
      link.merchant.autoSavePercent,
    );
    try {
      return await this.prisma.settlement.create({
        data: {
          merchantId: link.merchantId,
          linkId: link.id,
          paymentId: link.payments[0].id, // the payment that completed the link
          amountTRY: split.amountTRY,
          amountUSDC: split.amountUSDC,
          savedUSDC: split.savedUSDC,
          fxRate: link.fxRate,
          provider: this.config.anchorProvider,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return this.prisma.settlement.findUnique({ where: { linkId } });
      throw err;
    }
  }

  /** One adapter call per settlement at a time; a second caller waits for the first. */
  run(id: string): Promise<void> {
    const current = this.inFlight.get(id);
    if (current) return current;
    const p = this.runOnce(id).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, p);
    return p;
  }

  private async runOnce(id: string): Promise<void> {
    const row = await this.prisma.settlement.findUnique({ where: { id }, include: { merchant: true } });
    if (!row || (row.status !== 'pending' && row.status !== 'processing')) return;
    // A settlement always continues on the provider it was created with.
    const adapter = this.adapters.get(row.provider);
    if (!adapter) {
      if (!this.warnedNoAdapter.has(row.provider)) {
        this.logger.warn(`no '${row.provider}' anchor adapter configured: ${row.provider} settlements stay pending`);
        this.warnedNoAdapter.add(row.provider);
      }
      return;
    }

    const view = {
      id: row.id,
      merchantId: row.merchantId,
      amountUSDC: formatUSDC(row.amountUSDC),
      amountTRY: formatTRY(row.amountTRY),
      status: row.status,
      anchorRef: row.anchorRef,
      anchorMemo: row.anchorMemo,
      anchorStatus: row.anchorStatus,
      payTo: row.payTo,
      payMemo: row.payMemo,
      payMemoType: row.payMemoType,
      paymentXdr: row.paymentXdr,
      paymentTxHash: row.paymentTxHash,
    };
    const ctx: SettleContext = {
      settlement: view,
      merchant: merchantView(row.merchant),
      progress: async (p: Progress) => {
        await this.prisma.settlement.update({ where: { id }, data: p as Prisma.SettlementUpdateInput });
      },
      saveSep12: async (c) => {
        await this.prisma.merchant.update({ where: { id: row.merchantId }, data: c });
      },
    };

    let outcome;
    try {
      outcome = await adapter.settle(ctx);
    } catch (err) {
      // Transient by definition: the settlement stays exactly as it is for the next run.
      this.logger.error(`settlement ${id} (${row.provider}): ${redactIban(describe(err))} — will retry`);
      return;
    }

    switch (outcome.kind) {
      case 'waiting':
        return;
      case 'blocked':
        await this.prisma.settlement.update({ where: { id }, data: { blockedReason: outcome.blockedReason } });
        this.logger.warn(`settlement ${id} blocked: ${outcome.blockedReason}; stays pending`);
        return;
      case 'failed':
        await this.prisma.settlement.update({ where: { id }, data: { status: 'failed', failReason: outcome.failReason, completedAt: new Date() } });
        this.logger.error(`settlement ${id} FAILED: ${outcome.failReason} — reconcile by hand`);
        return;
      case 'completed': {
        const booked = bookCompletion(view, outcome.completion);
        if ('failReason' in booked) {
          await this.prisma.settlement.update({ where: { id }, data: { status: 'failed', failReason: booked.failReason, completedAt: new Date() } });
          this.logger.error(`settlement ${id} FAILED: ${booked.failReason} — the anchor already paid out; reconcile by hand`);
          return;
        }
        await this.prisma.settlement.update({
          where: { id },
          data: { status: 'completed', feeUSDC: booked.feeUSDC, netTRY: booked.netTRY, blockedReason: null, completedAt: new Date() },
        });
        this.logger.log(`settlement ${id} completed: net ${booked.netTRY} TRY, fee ${booked.feeUSDC} USDC`);
        return;
      }
    }
  }

  async list(merchantId: string, q: PageQuery): Promise<Paginated<Settlement>> {
    const where = { merchantId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.settlement.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageWindow(q) }),
      this.prisma.settlement.count({ where }),
    ]);
    return { items: rows.map(toSettlement), total };
  }
}

function merchantView(m: MerchantRow) {
  return { id: m.id, iban: m.iban, sep12CustomerId: m.sep12CustomerId, sep12Iban: m.sep12Iban, sep12HomeDomain: m.sep12HomeDomain };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
