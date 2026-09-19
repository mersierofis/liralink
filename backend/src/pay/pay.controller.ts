import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { GetPayResponse, GetPayStatusResponse, PostPaySubmittedResponse } from '../contract/api.types';
import { AppConfig } from '../config/app-config';
import type { LinkWithPayments } from '../links/link.mapper';
import { LinksService } from '../links/links.service';
import { PayQuoteDto, PayStatusDto, PaySubmittedDto, PaySubmittedResponseDto } from './pay.dto';
import { toPayQuote, toPayStatus } from './pay.mapper';
import { PaymentNudge } from './payment-nudge';

/** Payer endpoints: public, no auth. */
@ApiTags('pay')
@Controller('pay')
export class PayController {
  constructor(
    private readonly links: LinksService,
    private readonly config: AppConfig,
    private readonly nudge: PaymentNudge,
  ) {}

  /**
   * GET /pay/:code → 200. `code` is case-insensitive; 404 unknown code. Never re-quotes: past
   * expiresAt the link comes back 'expired' with its original, locked quote.
   */
  @Get(':code')
  @ApiOkResponse({ type: PayQuoteDto })
  async get(@Param('code') code: string): Promise<GetPayResponse> {
    return toPayQuote(await this.find(code), this.config);
  }

  /** GET /pay/:code/status → 200. What the payer page polls (every 2 s) after paying. 404 unknown code. */
  @Get(':code/status')
  @ApiOkResponse({ type: PayStatusDto })
  async status(@Param('code') code: string): Promise<GetPayStatusResponse> {
    return toPayStatus(await this.find(code), this.config);
  }

  /**
   * POST /pay/:code/submitted → 202. A hint that the payer just submitted `txHash`: payment
   * detection runs now instead of on its next tick. Detection works without it. 404 unknown code.
   */
  @Post(':code/submitted')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ type: PaySubmittedResponseDto })
  async submitted(@Param('code') code: string, @Body() _body: PaySubmittedDto): Promise<PostPaySubmittedResponse> {
    await this.find(code);
    this.nudge.nudge();
    return { accepted: true };
  }

  private async find(code: string): Promise<LinkWithPayments> {
    const row = await this.links.findByCode(code);
    if (!row) throw new NotFoundException('Link not found');
    return row;
  }
}
