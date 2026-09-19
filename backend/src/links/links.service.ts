import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InvoiceContractService } from '../invoice/invoice-contract.service';
import type { GetLinksQuery, Paginated, PaymentLink, PostLinksRequest } from '../contract/api.types';
import { AppConfig } from '../config/app-config';
import type { Merchant as MerchantRow } from '../generated/prisma/client';
import { pageWindow } from '../common/pagination.dto';
import { quoteUSDC } from '../common/money';
import { FxService, type FxQuote } from '../fx/fx.service';
import { FxUnavailableError } from '../fx/fx.types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, isUniqueViolation, isUuid } from '../prisma/prisma.service';
import { generateLinkCode, normalizeLinkCode } from './link-code';
import { type LinkWithPayments, toPaymentLink, withPayments } from './link.mapper';

const HOUR_MS = 3_600_000;
const CODE_ATTEMPTS = 5;

@Injectable()
export class LinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly config: AppConfig,
    private readonly invoices: InvoiceContractService,
  ) {}

  /**
   * Quote once, lock forever: amountTRY (what the merchant is owed) and quotedUSDC (what the payer
   * sends) are fixed here, from the rate at this moment, and nothing ever recomputes them. Quotes
   * are never re-quoted: the quote lives exactly as long as the link (quoteExpiresAt = expiresAt),
   * and when it lapses the link expires.
   * The rate's source, timestamp, mid rate and spread are stored with it for the receipt.
   * No rate, no link: if the rate cannot be fetched this is a 503, never a stale or guessed rate.
   * The on-chain invoice is best-effort and time-boxed: it never fails or stalls link creation.
   */
  async create(merchant: MerchantRow, body: PostLinksRequest): Promise<PaymentLink> {
    const fx = await this.freshRate();
    const quotedUSDC = quoteUSDC(body.amountTRY, fx.rate);
    const hours = body.expiresInHours ?? this.config.env.LINK_DEFAULT_EXPIRY_HOURS;
    const expiresAt = new Date(Date.now() + hours * HOUR_MS);

    for (let attempt = 1; ; attempt++) {
      try {
        const row = await this.prisma.paymentLink.create({
          data: {
            code: generateLinkCode(),
            merchantId: merchant.id,
            merchantName: merchant.businessName,
            title: body.title.trim(),
            description: body.description ?? null,
            amountTRY: body.amountTRY,
            quotedUSDC,
            fxRate: fx.rate,
            fxSource: fx.source,
            fxRateAt: fx.fetchedAt,
            fxMidRate: fx.midRate,
            fxSpread: fx.spread,
            fxQuoteRaw: fx.raw === null ? Prisma.DbNull : (fx.raw as Prisma.InputJsonValue),
            quoteExpiresAt: expiresAt,
            expiresAt,
          },
          include: withPayments,
        });
        return this.map(await this.invoices.registerWithin(row));
      } catch (err) {
        // Only the code can collide: retry with a fresh one.
        if (!isUniqueViolation(err) || attempt >= CODE_ATTEMPTS) throw err;
      }
    }
  }

  async list(merchant: MerchantRow, query: GetLinksQuery): Promise<Paginated<PaymentLink>> {
    await this.expireDue({ merchantId: merchant.id });
    const where = { merchantId: merchant.id, ...(query.status && { status: query.status }) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.paymentLink.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
        include: withPayments,
      }),
      this.prisma.paymentLink.count({ where }),
    ]);
    return { items: rows.map((r) => this.map(r)), total };
  }

  async get(merchant: MerchantRow, id: string): Promise<PaymentLink> {
    return this.map(await this.findOwn(merchant, id));
  }

  /**
   * Only an `open` link can be cancelled (409 otherwise). Its on-chain invoice is cancelled too,
   * best-effort and in the background: the API cancel never waits on or fails with RPC.
   */
  async cancel(merchant: MerchantRow, id: string): Promise<PaymentLink> {
    const link = await this.findOwn(merchant, id);
    const { count } = await this.prisma.paymentLink.updateMany({
      where: { id: link.id, status: 'open' },
      data: { status: 'cancelled' },
    });
    if (count === 0) {
      const current = await this.findOwn(merchant, id);
      throw new ConflictException(`Link is ${current.status}; only an open link can be cancelled`);
    }
    const cancelled = await this.findOwn(merchant, id);
    void this.invoices.cancelBestEffort(cancelled);
    return this.map(cancelled);
  }

  /**
   * POST /links/:id/onchain: manual retry of the on-chain invoice, with the link's locked
   * quotedUSDC. 503 if no contract is configured or RPC fails; 409 unless open with nothing
   * received; unchanged if already on the configured contract.
   */
  async putOnchain(merchant: MerchantRow, id: string): Promise<PaymentLink> {
    const contractId = this.invoices.contractId;
    if (!contractId) throw new ServiceUnavailableException('The contract rail is off: no invoice contract is configured');
    const link = await this.findOwn(merchant, id);
    if (link.onchainContractId === contractId) return this.map(link);
    if (link.status !== 'open' || !link.receivedUSDC.isZero()) {
      throw new ConflictException(`Link is ${link.status}; only an open link with nothing received can go on-chain`);
    }
    try {
      return this.map(await this.invoices.register(link));
    } catch (err) {
      throw new ServiceUnavailableException(`On-chain invoice failed, the link stays on the memo rail: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Public lookup by code (case-insensitive); null if no link has it. */
  async findByCode(rawCode: string): Promise<LinkWithPayments | null> {
    const code = normalizeLinkCode(rawCode);
    if (!code) return null;
    await this.expireDue({ code });
    return this.prisma.paymentLink.findUnique({ where: { code }, include: withPayments });
  }

  /**
   * Expire on read: every path that returns a link first moves the matching `open` links whose
   * expiresAt has passed to `expired`, so no response ever shows an open link with a lapsed quote.
   * One conditional UPDATE; a link that is no longer `open` is never touched.
   */
  private async expireDue(where: Prisma.PaymentLinkWhereInput): Promise<void> {
    await this.prisma.paymentLink.updateMany({
      where: { ...where, status: 'open', expiresAt: { lte: new Date() } },
      data: { status: 'expired' },
    });
  }

  private async freshRate(): Promise<FxQuote> {
    try {
      return await this.fx.getRate();
    } catch (err) {
      if (err instanceof FxUnavailableError) {
        throw new ServiceUnavailableException(`FX rate unavailable, no link created: ${err.message}`);
      }
      throw err;
    }
  }

  private async findOwn(merchant: MerchantRow, id: string): Promise<LinkWithPayments> {
    // Another merchant's link is indistinguishable from a missing one.
    if (isUuid(id)) await this.expireDue({ id, merchantId: merchant.id });
    const row = isUuid(id)
      ? await this.prisma.paymentLink.findFirst({ where: { id, merchantId: merchant.id }, include: withPayments })
      : null;
    if (!row) throw new NotFoundException('Link not found');
    return row;
  }

  private map(row: LinkWithPayments): PaymentLink {
    return toPaymentLink(row, this.config);
  }
}
