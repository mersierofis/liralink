import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  GetLinkResponse,
  GetLinksResponse,
  PostLinkCancelResponse,
  PostLinkOnchainResponse,
  PostLinksResponse,
} from '../contract/api.types';
import type { Merchant as MerchantRow } from '../generated/prisma/client';
import { CurrentMerchant } from '../auth/current-merchant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateLinkDto, LinksQueryDto, PaginatedLinksDto, PaymentLinkDto } from './links.dto';
import { LinksService } from './links.service';

@ApiTags('links')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('links')
export class LinksController {
  constructor(private readonly links: LinksService) {}

  /** POST /links → 201. Locks amountTRY and quotedUSDC. */
  @Post()
  @ApiCreatedResponse({ type: PaymentLinkDto })
  create(@CurrentMerchant() merchant: MerchantRow, @Body() body: CreateLinkDto): Promise<PostLinksResponse> {
    return this.links.create(merchant, body);
  }

  /** GET /links?status=&page=&limit= → 200, newest first. */
  @Get()
  @ApiOkResponse({ type: PaginatedLinksDto })
  list(@CurrentMerchant() merchant: MerchantRow, @Query() query: LinksQueryDto): Promise<GetLinksResponse> {
    return this.links.list(merchant, query);
  }

  /** GET /links/:id → 200 */
  @Get(':id')
  @ApiOkResponse({ type: PaymentLinkDto })
  get(@CurrentMerchant() merchant: MerchantRow, @Param('id') id: string): Promise<GetLinkResponse> {
    return this.links.get(merchant, id);
  }

  /** POST /links/:id/cancel → 200. Only if `open`, else 409. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PaymentLinkDto })
  cancel(@CurrentMerchant() merchant: MerchantRow, @Param('id') id: string): Promise<PostLinkCancelResponse> {
    return this.links.cancel(merchant, id);
  }

  /** POST /links/:id/onchain → 200. Retries the on-chain invoice; 409 unless open with nothing received, 503 if no contract or RPC fails. */
  @Post(':id/onchain')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PaymentLinkDto })
  putOnchain(@CurrentMerchant() merchant: MerchantRow, @Param('id') id: string): Promise<PostLinkOnchainResponse> {
    return this.links.putOnchain(merchant, id);
  }
}
