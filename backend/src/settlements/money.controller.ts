import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { GetBalanceResponse, GetPaymentsResponse, GetSettlementsResponse, PaymentWithLink } from '../contract/api.types';
import { AppConfig } from '../config/app-config';
import { formatTRY, formatUSDC } from '../common/money';
import { PageQueryDto, pageWindow } from '../common/pagination.dto';
import type { Merchant as MerchantRow } from '../generated/prisma/client';
import { CurrentMerchant } from '../auth/current-merchant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { toPayment } from '../links/link.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { BalanceService } from './balance.service';
import { toSettlement } from './settlement.mapper';
import { SettlementsService } from './settlements.service';

@ApiTags('money')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MoneyController {
  constructor(
    private readonly balance: BalanceService,
    private readonly settlements: SettlementsService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** GET /balance → 200 */
  @Get('balance')
  getBalance(@CurrentMerchant() merchant: MerchantRow): Promise<GetBalanceResponse> {
    return this.balance.get(merchant);
  }

  /** GET /settlements?page=&limit= → 200. One per paid link, newest first. */
  @Get('settlements')
  getSettlements(@CurrentMerchant() merchant: MerchantRow, @Query() q: PageQueryDto): Promise<GetSettlementsResponse> {
    return this.settlements.list(merchant.id, q);
  }

  /**
   * GET /payments?page=&limit= → 200, newest first. `link.*` are current values; `settlement` is
   * null for an installment that did not complete its link.
   */
  @Get('payments')
  async getPayments(@CurrentMerchant() merchant: MerchantRow, @Query() q: PageQueryDto): Promise<GetPaymentsResponse> {
    const where = { link: { merchantId: merchant.id } };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({ where, orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }], ...pageWindow(q), include: { link: true, settlement: true } }),
      this.prisma.payment.count({ where }),
    ]);
    const items: PaymentWithLink[] = rows.map((r) => ({
      ...toPayment(r, this.config),
      link: {
        code: r.link.code,
        title: r.link.title,
        amountTRY: formatTRY(r.link.amountTRY),
        status: r.link.status,
        quotedUSDC: formatUSDC(r.link.quotedUSDC),
        receivedUSDC: formatUSDC(r.link.receivedUSDC),
      },
      settlement: r.settlement ? toSettlement(r.settlement) : null,
    }));
    return { items, total };
  }
}
