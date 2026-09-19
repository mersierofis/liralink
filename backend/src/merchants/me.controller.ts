import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { GetMeResponse, PatchMeResponse } from '../contract/api.types';
import type { Merchant as MerchantRow } from '../generated/prisma/client';
import { CurrentMerchant } from '../auth/current-merchant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MerchantDto, PatchMeDto } from './merchant.dto';
import { MerchantsService } from './merchants.service';

@ApiTags('merchant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly merchants: MerchantsService) {}

  /** GET /me → 200 */
  @Get()
  @ApiOkResponse({ type: MerchantDto })
  get(@CurrentMerchant() merchant: MerchantRow): GetMeResponse {
    return this.merchants.me(merchant);
  }

  /** PATCH /me → 200. 400 if only one password field is sent, 403 if currentPassword is wrong. */
  @Patch()
  @ApiOkResponse({ type: MerchantDto })
  update(@CurrentMerchant() merchant: MerchantRow, @Body() body: PatchMeDto): Promise<PatchMeResponse> {
    return this.merchants.update(merchant, body);
  }
}
