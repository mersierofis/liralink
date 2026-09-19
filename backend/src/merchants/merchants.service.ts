import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Merchant, PatchMeRequest } from '../contract/api.types';
import { AppConfig } from '../config/app-config';
import type { Merchant as MerchantRow, Prisma } from '../generated/prisma/client';
import { fitsBcrypt, hashPassword, verifyPassword } from '../auth/passwords';
import { PrismaService } from '../prisma/prisma.service';
import { toMerchant } from './merchant.mapper';

@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  me(row: MerchantRow): Merchant {
    return toMerchant(row, this.config);
  }

  async update(row: MerchantRow, body: PatchMeRequest): Promise<Merchant> {
    const data: Prisma.MerchantUpdateInput = {};
    if (body.businessName !== undefined) data.businessName = body.businessName.trim();
    if (body.iban !== undefined) data.iban = body.iban;
    if (body.autoSavePercent !== undefined) data.autoSavePercent = body.autoSavePercent;

    if ((body.currentPassword === undefined) !== (body.newPassword === undefined)) {
      throw new BadRequestException(['currentPassword and newPassword must be sent together']);
    }
    if (body.currentPassword !== undefined && body.newPassword !== undefined) {
      if (!fitsBcrypt(body.newPassword)) throw new BadRequestException(['newPassword must be at most 72 bytes']);
      if (!(await verifyPassword(body.currentPassword, row.passwordHash))) {
        throw new ForbiddenException('currentPassword is wrong');
      }
      data.passwordHash = await hashPassword(body.newPassword);
    }

    const updated = await this.prisma.merchant.update({ where: { id: row.id }, data });
    return toMerchant(updated, this.config);
  }
}
