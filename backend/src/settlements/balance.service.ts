import { Injectable } from '@nestjs/common';
import type { Balance } from '../contract/api.types';
import { formatTRY, formatUSDC, subtractTRY } from '../common/money';
import type { Merchant as MerchantRow } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Providers whose settlements credit the merchant's TRY balance. Everything else pays the IBAN
 * directly (auto-payout) and counts in paidOutTRY. A new balance-mode provider MUST be added here,
 * or its settlements land in paidOutTRY (01-BACKEND.md).
 */
export const BALANCE_MODE_PROVIDERS = ['mock'] as const;

/** 00-PROJECT.md §6, Balance rules. The bucket follows the provider a settlement was created with. */
@Injectable()
export class BalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async get(merchant: MerchantRow): Promise<Balance> {
    const m = merchant.id;
    const balanceMode = { in: [...BALANCE_MODE_PROVIDERS] };
    const [credited, paidOut, pending, saved, withdrawn] = await Promise.all([
      this.prisma.settlement.aggregate({ where: { merchantId: m, status: 'completed', provider: balanceMode }, _sum: { netTRY: true } }),
      this.prisma.settlement.aggregate({ where: { merchantId: m, status: 'completed', provider: { notIn: [...BALANCE_MODE_PROVIDERS] } }, _sum: { netTRY: true } }),
      this.prisma.settlement.aggregate({ where: { merchantId: m, status: { in: ['pending', 'processing'] } }, _sum: { amountTRY: true } }),
      this.prisma.settlement.aggregate({ where: { merchantId: m, status: { not: 'failed' } }, _sum: { savedUSDC: true } }),
      this.prisma.withdrawal.aggregate({ where: { merchantId: m, status: { not: 'failed' } }, _sum: { amountTRY: true } }),
    ]);
    const current = await this.prisma.merchant.findUniqueOrThrow({ where: { id: m }, select: { unallocatedUSDC: true } });
    const zero = '0';
    return {
      availableTRY: subtractTRY(credited._sum.netTRY ?? zero, withdrawn._sum.amountTRY ?? zero),
      pendingTRY: formatTRY(pending._sum.amountTRY ?? zero),
      // USDC withdrawals from `saved` do not exist yet; when they do, subtract them here.
      savedUSDC: formatUSDC(saved._sum.savedUSDC ?? zero),
      unallocatedUSDC: formatUSDC(current.unallocatedUSDC),
      paidOutTRY: formatTRY(paidOut._sum.netTRY ?? zero),
    };
  }
}
