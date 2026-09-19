import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { GetPayResponse } from '../contract/api.types';
import { AppConfig } from '../config/app-config';
import { LinksService } from '../links/links.service';
import { PayQuoteDto } from './pay.dto';
import { toPayQuote } from './pay.mapper';

/** Payer endpoints: public, no auth. */
@ApiTags('pay')
@Controller('pay')
export class PayController {
  constructor(
    private readonly links: LinksService,
    private readonly config: AppConfig,
  ) {}

  /** GET /pay/:code → 200. `code` is case-insensitive; 404 unknown code. Never re-quotes. */
  @Get(':code')
  @ApiOkResponse({ type: PayQuoteDto })
  async get(@Param('code') code: string): Promise<GetPayResponse> {
    const row = await this.links.findByCode(code);
    if (!row) throw new NotFoundException('Link not found');
    return toPayQuote(row, this.config);
  }
}
