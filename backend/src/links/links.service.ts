import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { GetLinksQuery, Paginated, PaymentLink, PostLinksRequest } from '../contract/api.types';
import { AppConfig } from '../config/app-config';
import type { Merchant as MerchantRow } from '../generated/prisma/client';
import { pageWindow } from '../common/pagination.dto';
import { quoteUSDC } from '../common/money';
import { FxService } from '../fx/fx.service';
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
  ) {}

  /**
   * Quote once, lock forever: amountTRY (what the merchant is owed) and quotedUSDC (what the payer
   * sends) are fixed here, from the rate at this moment, and nothing ever recomputes them. The
   * quote therefore stays valid for the link's whole life: quoteExpiresAt = expiresAt.
   */
  async create(merchant: MerchantRow, body: PostLinksRequest): Promise<PaymentLink> {
    const { rate } = await this.fx.getRate();
    const quotedUSDC = quoteUSDC(body.amountTRY, rate);
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
            fxRate: rate,
            quoteExpiresAt: expiresAt,
            expiresAt,
          },
          include: withPayments,
        });
        return this.map(row);
      } catch (err) {
        // Only the code can collide: retry with a fresh one.
        if (!isUniqueViolation(err) || attempt >= CODE_ATTEMPTS) throw err;
      }
    }
  }

  async list(merchant: MerchantRow, query: GetLinksQuery): Promise<Paginated<PaymentLink>> {
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

  /** Only an `open` link can be cancelled (409 otherwise). No on-chain invoice exists in this build. */
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
    return this.get(merchant, id);
  }

  /** Public lookup by code (case-insensitive); null if no link has it. */
  async findByCode(rawCode: string): Promise<LinkWithPayments | null> {
    const code = normalizeLinkCode(rawCode);
    if (!code) return null;
    return this.prisma.paymentLink.findUnique({ where: { code }, include: withPayments });
  }

  private async findOwn(merchant: MerchantRow, id: string): Promise<LinkWithPayments> {
    // Another merchant's link is indistinguishable from a missing one.
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
